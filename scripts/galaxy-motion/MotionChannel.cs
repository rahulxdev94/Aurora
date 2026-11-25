using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web;
using System.Web.Script.Serialization;

namespace GalaxyAtlas.Motion {
    // Private per-login bridge. Coordinates are retained in memory only while a wave is visible.
    internal sealed class MotionChannel : IDisposable {
        sealed class Wave { public long id, at; public double u,v; }
        readonly object sync = new object();
        readonly List<Wave> waves = new List<Wave>();
        readonly GalaxyMotionHost host;
        readonly TcpListener listener = new TcpListener(IPAddress.Loopback,0);
        readonly string token;
        long expiry, sequence;
        int port, clients;
        bool closed;
        static readonly CultureInfo invariant = CultureInfo.InvariantCulture;
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        static extern bool MoveFileEx(string oldName,string newName,uint flags);
        public MotionChannel(GalaxyMotionHost host) {
            this.host = host;
            var random=new byte[32];
            using(var generator=RandomNumberGenerator.Create())generator.GetBytes(random);
            token=BitConverter.ToString(random).Replace("-","").ToLowerInvariant();
        }
        public bool Active { get {return Interlocked.Read(ref expiry)>GalaxyMotionHost.Now;} }
        public void Start() {
            listener.Start(6);
            port=((IPEndPoint)listener.LocalEndpoint).Port;
            string file=GalaxyMotionHost.SessionFile;
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temp=file+"."+Guid.NewGuid().ToString("N");
            try {
                File.WriteAllText(temp,new JavaScriptSerializer().Serialize(new{port,token}),new UTF8Encoding(false));
                // Seelen can be reading the old endpoint during a service restart. Publish the
                // entire new record by same-directory rename once that reader releases it.
                for (int attempt=0; !MoveFileEx(temp,file,1U|8U); attempt++) {
                    int error=Marshal.GetLastWin32Error();
                    if (attempt>=99) throw new IOException("Failed to publish the local motion session (Win32 "+error+").");
                    Thread.Sleep(100);
                }
            } finally { if(File.Exists(temp))File.Delete(temp); }
            var thread=new Thread(Accept){IsBackground=true};thread.Start();
        }
        void Accept() {
            try {
                for(;;) {
                    var client=listener.AcceptTcpClient();
                    if(Interlocked.Increment(ref clients)>8){Interlocked.Decrement(ref clients);client.Close();continue;}
                    ThreadPool.QueueUserWorkItem(delegate{
                        try{using(client)Handle(client);}catch(IOException){}catch(SocketException){}catch(ObjectDisposedException){}
                        finally{Interlocked.Decrement(ref clients);}
                    });
                }
            } catch(SocketException){} catch(ObjectDisposedException){}
        }
        internal void Publish(double u,double v,long at) {
            lock(sync) {
                waves.RemoveAll(w=>at-w.at>=2050);
                if(waves.Count>=4)waves.RemoveAt(0);
                waves.Add(new Wave{id=++sequence,at=at,u=u,v=v});
                Monitor.PulseAll(sync);
            }
        }
        string Next(long after) {
            bool wasActive=Active;
            Interlocked.Exchange(ref expiry,GalaxyMotionHost.Now+26000);
            if(!wasActive)host.OnUi(()=>host.Gate(Active));
            lock(sync) {
                if(after>=sequence && wasActive && !closed)Monitor.Wait(sync,12000);
                long now=GalaxyMotionHost.Now;
                waves.RemoveAll(w=>now-w.at>=2050);
                return new JavaScriptSerializer().Serialize(new{cursor=sequence,waves=waves.FindAll(w=>w.id>after)});
            }
        }
        static bool AllowedOrigin(string origin) {return origin=="http://tauri.localhost"||origin=="https://tauri.localhost"||origin=="tauri://localhost";}
        static void Reply(Stream stream,string status,string origin,string json) {
            byte[] body=Encoding.UTF8.GetBytes(json);
            string headers="HTTP/1.1 "+status+"\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: application/json\r\nContent-Length: "+body.Length+"\r\n";
            if(AllowedOrigin(origin))headers+="Access-Control-Allow-Origin: "+origin+"\r\nVary: Origin\r\nAccess-Control-Allow-Headers: Authorization\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n";
            byte[] head=Encoding.ASCII.GetBytes(headers+"\r\n");
            stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);
        }
        void Handle(TcpClient client) {
            client.ReceiveTimeout=1800;client.SendTimeout=2000;client.NoDelay=true;
            var stream=client.GetStream();
            var bytes=new List<byte>(512);
            while(bytes.Count<8192) {
                int b=stream.ReadByte();if(b<0)return;
                bytes.Add((byte)b);int n=bytes.Count;
                if(n>=4 && b==10 && bytes[n-2]==13 && bytes[n-3]==10 && bytes[n-4]==13)break;
            }
            if(bytes.Count>=8192)return;
            string[] lines=Encoding.ASCII.GetString(bytes.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);
            string[] req=lines[0].Split(' ');
            var fields=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            for(int i=1;i<lines.Length;i++){int split=lines[i].IndexOf(':');if(split>0)fields[lines[i].Substring(0,split)]=lines[i].Substring(split+1).Trim();}
            string origin,address,auth;
            fields.TryGetValue("Origin",out origin);
            if(req.Length!=3||!fields.TryGetValue("Host",out address)||address!="127.0.0.1:"+port||(origin!=null&&!AllowedOrigin(origin))){Reply(stream,"403 Forbidden",null,"{}");return;}
            if(req[0]=="OPTIONS"){Reply(stream,"204 No Content",origin,"");return;}
            if(!fields.TryGetValue("Authorization",out auth)||auth!="Bearer "+token){Reply(stream,"403 Forbidden",null,"{}");return;}
            int q=req[1].IndexOf('?');string path=q<0?req[1]:req[1].Substring(0,q);
            var args=HttpUtility.ParseQueryString(q<0?"":req[1].Substring(q+1));
            long after,at;double u,v;
            string result="{}";
            if(req[0]=="GET" && path=="/waves" && Int64.TryParse(args["after"],out after) && after>=0)result=Next(after);
            else if(req[0]=="POST" && path=="/off"){
                Interlocked.Exchange(ref expiry,0);lock(sync){waves.Clear();Monitor.PulseAll(sync);}
                host.OnUi(()=>host.Gate(Active));
            } else if(req[0]=="POST" && path=="/desktop" && Active && Int64.TryParse(args["at"],out at)
                && Double.TryParse(args["u"],NumberStyles.Float,invariant,out u) && u>=0 && u<=1
                && Double.TryParse(args["v"],NumberStyles.Float,invariant,out v) && v>=0 && v<=1
                && at<=GalaxyMotionHost.Now+100 && at>=GalaxyMotionHost.Now-2050)host.OnUi(()=>host.Desktop(u,v,at));
            else {Reply(stream,"400 Bad Request",origin,"{}");return;}
            Reply(stream,"200 OK",origin,result);
        }
        public void Dispose(){
            Interlocked.Exchange(ref expiry,0);lock(sync){closed=true;Monitor.PulseAll(sync);}
            listener.Stop();
            try{string file=GalaxyMotionHost.SessionFile;if(File.Exists(file)&&File.ReadAllText(file).Contains(token))File.Delete(file);}catch(IOException){}
        }
    }
}
