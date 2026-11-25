using System;
using System.IO;
using System.Net;
using System.Globalization;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml;
using System.Xml.Linq;

namespace GalaxyAtlas.Motion {
    internal static class PublicMediaFeeds {
        static readonly Regex Channel = new Regex(@"\AUC[A-Za-z0-9_-]{22}\z");
        static readonly Regex Video = new Regex(@"\A[A-Za-z0-9_-]{11}\z");
        static readonly XNamespace Atom = "http://www.w3.org/2005/Atom", Yt = "http://www.youtube.com/xml/schemas/2015";
        internal static string Get(string route,string channel) {
            bool uploads = route == "/media/uploads";
            if (uploads && !Channel.IsMatch(channel ?? "")) throw new ArgumentException("Channel ID");
            if (!uploads && route != "/media/top10") throw new ArgumentException("Unknown feed");
            string address = uploads ? "https://www.youtube.com/feeds/videos.xml?channel_id=" + channel :
                "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv";
            var request = (HttpWebRequest)WebRequest.Create(address);
            request.AllowAutoRedirect = false;
            request.UserAgent = "GalaxyAtlas/1.0";
            request.Timeout = request.ReadWriteTimeout = 10000;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using(var response = (HttpWebResponse)request.GetResponse())
            using(var stream = response.GetResponseStream()) {
                if(response.StatusCode != HttpStatusCode.OK) throw new IOException("Feed unavailable");
                object result = uploads ? ReadChannel(stream,channel) : ReadChart(stream);
                return new JavaScriptSerializer().Serialize(result);
            }
        }
        static object ReadChannel(Stream stream,string channel) {
            var settings = new XmlReaderSettings {DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=524288};
            using(var reader = XmlReader.Create(stream,settings)) {
                var feed = XDocument.Load(reader).Root;
                string idInFeed=feed==null ? null : (string)feed.Element(Yt+"channelId");
                if(idInFeed!=channel && "UC"+idInFeed!=channel) throw new IOException("Unexpected channel");
                var videos = new List<object>();
                foreach(var entry in feed.Elements(Atom+"entry")) {
                    string id = (string)entry.Element(Yt+"videoId"), title = (string)entry.Element(Atom+"title");
                    if((string)entry.Element(Yt+"channelId") != channel || !Video.IsMatch(id ?? "") || String.IsNullOrWhiteSpace(title)) continue;
                    videos.Add(new {id,title,published=(string)entry.Element(Atom+"published")});
                    if(videos.Count == 12) break;
                }
                return new {channel,name=(string)feed.Element(Atom+"title"),videos};
            }
        }
        static object ReadChart(Stream stream) {
            using(var reader = new StreamReader(stream)) {
                string[] header=(reader.ReadLine() ?? "").Split('\t');
                int country=Array.IndexOf(header,"country_iso2"), period=Array.IndexOf(header,"week"),category=Array.IndexOf(header,"category"),
                    rank=Array.IndexOf(header,"weekly_rank"),title=Array.IndexOf(header,"show_title"),season=Array.IndexOf(header,"season_title");
                if(Array.IndexOf(new[]{country,period,category,rank,title,season},-1)>=0) throw new IOException("Unrecognised chart");
                string week=null,line; int bytes=0,collected=0;
                string[] films=new string[10],tv=new string[10];
                while(bytes<8000000 && (line=reader.ReadLine())!=null) {
                    bytes+=line.Length+1;
                    string[] cells=line.Split('\t');
                    if(cells.Length<header.Length || cells[country]!="AU") continue;
                    DateTime date;
                    if(!DateTime.TryParseExact(cells[period],"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out date)) continue;
                    if(week==null || String.CompareOrdinal(cells[period],week)>0) {
                        week=cells[period];Array.Clear(films,0,10);Array.Clear(tv,0,10);collected=0;
                    }
                    if(cells[period]!=week) continue;
                    int n; if(!int.TryParse(cells[rank],out n) || n<1 || n>10)continue;
                    var list=cells[category]=="Films" ? films : cells[category]=="TV" ? tv : null;
                    if(list==null || list[n-1]!=null) continue;
                    string name=list==tv && !String.IsNullOrWhiteSpace(cells[season]) && cells[season]!="N/A" ? cells[season] : cells[title];
                    if(String.IsNullOrWhiteSpace(name))continue;
                    list[n-1]=name;
                    if(++collected==20) return new {week,films,tv};
                }
                throw new IOException("Incomplete Australian chart");
            }
        }
    }
}
