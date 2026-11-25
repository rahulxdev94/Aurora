using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace GalaxyAtlas.Motion {
    internal sealed class GalaxyMotionHost : Control {
        [StructLayout(LayoutKind.Sequential)]
        struct MouseDevice { public ushort page, usage; public uint flags; public IntPtr target; }
        [StructLayout(LayoutKind.Sequential)]
        struct NativeRect { public int left, top, right, bottom; }
        [DllImport("user32.dll")] static extern bool RegisterRawInputDevices(MouseDevice[] d, uint n, uint size);
        [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr buffer, ref uint size, uint headerSize);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flag);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w,out NativeRect r);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string title);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr mode);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        const int WM_INPUT = 0xff;
        internal static readonly string SessionFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"com.seelen.seelen-ui\data\galaxy-atlas-desktop\galaxy-motion-session.json");
        internal static long Now { get { return (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000; } }
        readonly GalaxyDockGlint rim = new GalaxyDockGlint();
        readonly IntPtr buffer = Marshal.AllocHGlobal(128);
        readonly Point?[] pressed = new Point?[3];
        readonly System.Windows.Forms.Timer leaseTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        MotionChannel channel;
        bool registered;
        IntPtr dock;
        Rectangle home, toolbar;
        long geometryAt;

        GalaxyMotionHost() {
            var handle = Handle;
            channel = new MotionChannel(this);
            channel.Start();
            leaseTimer.Tick += delegate { if (!channel.Active) Gate(false); };
        }
        internal void OnUi(Action fn) {
            if (!IsDisposed && IsHandleCreated) {
                try { BeginInvoke(fn); } catch (InvalidOperationException) {}
            }
        }
        internal void Gate(bool enable) {
            if (enable == registered) return;
            var device = new MouseDevice { page = 1, usage = 2, flags = enable ? 0x100U : 1U,
                target = enable ? Handle : IntPtr.Zero };
            if (!RegisterRawInputDevices(new[]{device}, 1, (uint)Marshal.SizeOf(typeof(MouseDevice)))) return;
            registered = enable;
            leaseTimer.Enabled = enable;
            if (!enable) { Array.Clear(pressed, 0, pressed.Length); rim.Cancel(); }
        }
        bool Geometry(long now) {
            if (now - geometryAt > 750 || dock == IntPtr.Zero) {
                geometryAt = now;
                var candidate = FindWindow("Tauri Window", "Dock/Taskbar");
                var desktop = FindWindow("Tauri Window", "Galaxy Atlas");
                uint a, b;
                GetWindowThreadProcessId(candidate, out a); GetWindowThreadProcessId(desktop, out b);
                NativeRect r;
                dock = IntPtr.Zero;
                if (a == 0 || a != b || !GetWindowRect(desktop, out r)) return false;
                try {
                    using (var process = Process.GetProcessById((int)a))
                        if (!String.Equals(process.ProcessName,"seelen-ui",StringComparison.OrdinalIgnoreCase)) return false;
                } catch (ArgumentException) { return false; }
                home = Rectangle.FromLTRB(r.left,r.top,r.right,r.bottom);
                dock = candidate;
                toolbar = Rectangle.Empty;
            }
            return dock != IntPtr.Zero && home.Width > 0 && home.Height > 0;
        }
        internal void Desktop(double u, double v, long at) {
            if (channel.Active && Geometry(Now))
                rim.Pulse(dock,new Point(home.Left+(int)Math.Round(u*home.Width), home.Top+(int)Math.Round(v*home.Height)),home,at);
        }
        void MouseMessage(IntPtr raw) {
            if (!registered || !channel.Active) return;
            uint size=128, header=(uint)(IntPtr.Size==8 ? 24 : 16);
            if (GetRawInputData(raw,0x10000003,buffer,ref size,header) == UInt32.MaxValue || size < header + 8) return;
            int buttons = (ushort)Marshal.ReadInt16(buffer,(int)header+4);
            if ((buttons & 63)==0) return;
            Point point;
            long at = Now;
            if (!GetCursorPos(out point) || !Geometry(at)) return;
            bool hit = home.Contains(point) && GetAncestor(WindowFromPoint(point),2)==dock;
            if (hit && toolbar.IsEmpty) toolbar = GalaxyDockGlint.GetDockBounds(dock);
            hit = hit && toolbar.Contains(point);
            for (int index=0; index<3; index++) {
                int down=1<<(2*index), up=down<<1;
                if ((buttons & down)!=0) pressed[index]=hit ? (Point?)point : null;
                if ((buttons & up)==0) continue;
                var from=pressed[index]; pressed[index]=null;
                if (!hit || !from.HasValue || Math.Abs(point.X-from.Value.X)>SystemInformation.DragSize.Width
                    || Math.Abs(point.Y-from.Value.Y)>SystemInformation.DragSize.Height) continue;
                channel.Publish((double)(point.X-home.Left)/home.Width, (double)(point.Y-home.Top)/home.Height, at);
                rim.Pulse(dock, point, home, at);
            }
        }
        protected override void WndProc(ref Message msg) {
            if (msg.Msg==WM_INPUT) MouseMessage(msg.LParam);
            base.WndProc(ref msg);
        }
        protected override void Dispose(bool disposing) {
            if (disposing) { Gate(false); leaseTimer.Dispose(); if(channel!=null)channel.Dispose(); rim.Dispose(); Marshal.FreeHGlobal(buffer); }
            base.Dispose(disposing);
        }
        [STAThread] static void Main() {
            bool first;
            using (var instance=new Mutex(true,@"Local\GalaxyAtlasMotion.1",out first)) {
                if(!first)return;
                try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); }
                using (var host=new GalaxyMotionHost()) Application.Run();
            }
        }
    }
}
