using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Forms;

namespace GalaxyAtlas.Motion
{
    // Call on the application's STA thread after selecting per-monitor DPI awareness.
    // This class has no input hook, focus handler, persistent data or idle timer.
    public sealed class GalaxyDockGlint : IDisposable
    {
        public const double DurationMs = 2050.0;
        private readonly Timer timer;
        private readonly Dictionary<IntPtr, Surface> surfaces = new Dictionary<IntPtr, Surface>();
        private bool disposed;

        public GalaxyDockGlint()
        {
            timer = new Timer(); timer.Interval = 16; timer.Tick += Tick;
        }

        public void Cancel()
        {
            timer.Stop();
            foreach (Surface surface in surfaces.Values) { surface.Waves.Clear(); surface.Hide(); }
        }

        public static Rectangle GetDockBounds(IntPtr dock)
        {
            if (!IsDock(dock)) return Rectangle.Empty;
            try
            {
                AutomationElement toolbar = AutomationElement.FromHandle(dock).FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ToolBar));
                return ToolbarBounds(dock, toolbar);
            }
            catch { return Rectangle.Empty; }
        }

        private static Rectangle ToolbarBounds(IntPtr dock, AutomationElement toolbar)
        {
            if (toolbar == null || toolbar.Current.IsOffscreen) return Rectangle.Empty;
            System.Windows.Rect rect = toolbar.Current.BoundingRectangle;
            if (rect.IsEmpty || Double.IsInfinity(rect.Width) || Double.IsNaN(rect.Width) || Double.IsInfinity(rect.Height) || Double.IsNaN(rect.Height)) return Rectangle.Empty;
            Rectangle next = Rectangle.Round(new RectangleF((float)rect.X, (float)rect.Y, (float)rect.Width, (float)rect.Height));
            Native.RECT outer; uint dpi = Native.GetDpiForWindow(dock); double scale = dpi > 0 ? dpi / 96.0 : 1;
            if (!Native.GetWindowRect(dock, out outer) || !outer.Rectangle.Contains(next) || next.Width < 32 * scale || next.Height < 16 * scale || next.Height > 200 * scale) return Rectangle.Empty;
            return next;
        }

        public void Pulse(IntPtr dock, Point screenOrigin, Rectangle homeBounds, long startUtcMs)
        {
            if (disposed || homeBounds.Width <= 0 || homeBounds.Height <= 0 || !IsDock(dock)) return;
            double age = UtcNowMs() - startUtcMs;
            if (age >= DurationMs || age < -250) return;
            Surface surface;
            if (!surfaces.TryGetValue(dock, out surface))
            {
                if (surfaces.Count >= 8) return;
                surface = new Surface(dock); surfaces.Add(dock, surface);
            }
            if (!surface.Measure(true)) return;
            foreach (Wave old in surface.Waves)
                if (old.Start == startUtcMs && old.Origin == screenOrigin) return;
            double diagonal = Math.Sqrt((double)homeBounds.Width * homeBounds.Width + (double)homeBounds.Height * homeBounds.Height);
            surface.Waves.Add(new Wave(screenOrigin, startUtcMs, Math.Max(.84 * surface.Scale, diagonal / 1700.0), age));
            if (surface.Waves.Count > 4) surface.Waves.RemoveAt(0);
            try { Paint(surface); } catch { surface.Hide(); } timer.Start();
        }

        private void Tick(object sender, EventArgs e)
        {
            bool active = false;
            foreach (Surface surface in surfaces.Values)
            {
                surface.Waves.RemoveAll(delegate(Wave wave) { return wave.Age >= DurationMs; });
                if (surface.Waves.Count == 0 || !IsDock(surface.Dock)) { surface.Hide(); continue; }
                active = true;
                if (!surface.Measure(false)) { surface.Hide(); continue; }
                try { Paint(surface); } catch { surface.Hide(); }
            }
            if (!active) timer.Stop();
        }

        private static void Paint(Surface surface)
        {
            if (!IsDock(surface.Dock) || surface.Bounds.IsEmpty) { surface.Hide(); return; }
            PointF[] rim = surface.Rim;
            if (rim == null || rim.Length < 8) { surface.Hide(); return; }
            Rectangle[] protectedScreen = ProtectedOverlaps(surface);
            Rectangle[] protectedLocal = new Rectangle[protectedScreen.Length];
            for (int index = 0; index < protectedScreen.Length; index++)
            {
                Rectangle rectangle = protectedScreen[index]; rectangle.Offset(-surface.Bounds.X, -surface.Bounds.Y); protectedLocal[index] = rectangle;
            }
            double[] light = new double[rim.Length]; double maximum = 0;
            for (int i = 0; i < rim.Length; i++)
            {
                if (ProtectedPoint(surface.Bounds.X + rim[i].X, surface.Bounds.Y + rim[i].Y, protectedScreen)) continue;
                foreach (Wave wave in surface.Waves)
                {
                    double dx = surface.Bounds.X + rim[i].X - wave.Origin.X;
                    double dy = surface.Bounds.Y + rim[i].Y - wave.Origin.Y;
                    light[i] += RimIntensity(wave.Age, Math.Sqrt(dx * dx + dy * dy), wave.Speed);
                }
                light[i] = Math.Min(1, light[i]); maximum = Math.Max(maximum, light[i]);
            }
            if (maximum < .012) { surface.Hide(); return; }
            using (Bitmap image = Compose(surface.Bounds.Width, surface.Bounds.Height, surface.Scale, rim, light, protectedLocal)) surface.Window.Present(image, surface.Bounds);
        }

        private static Bitmap Compose(int width, int height, double scale, PointF[] rim, double[] light, Rectangle[] protectedLocal)
        {
            Bitmap image = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
            try
            {
                using (Graphics graphics = Graphics.FromImage(image))
                using (GraphicsPath clip = RoundedPath(width, height, 28 * scale, 18 * scale, 0))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.CompositingQuality = CompositingQuality.HighQuality; graphics.SetClip(clip);
                    if (protectedLocal != null) foreach (Rectangle rectangle in protectedLocal) graphics.ExcludeClip(rectangle);
                    for (int i = 0; i < rim.Length; i++)
                    {
                        int next = (i + 1) % rim.Length; double intensity = (light[i] + light[next]) * .5;
                        if (intensity < .012) continue;
                        using (Pen halo = new Pen(Color.FromArgb((int)(Math.Min(1, intensity) * 39), 221, 176, 148), (float)(7 * scale)))
                        using (Pen edge = new Pen(Color.FromArgb((int)(Math.Min(1, intensity) * 202), 249, 235, 215), (float)(1.15 * scale)))
                        {
                            halo.StartCap = halo.EndCap = LineCap.Round; edge.StartCap = edge.EndCap = LineCap.Round;
                            graphics.DrawLine(halo, rim[i], rim[next]); graphics.DrawLine(edge, rim[i], rim[next]);
                        }
                    }
                }
                return image;
            }
            catch { image.Dispose(); throw; }
        }

        // Physical pixels / milliseconds. Shared epoch and speed keep the dock on
        // the same travelling rim as Home, including a delayed event delivery.
        public static double RimIntensity(double ageMs, double distancePx, double speedPxPerMs)
        {
            if (Double.IsNaN(ageMs) || Double.IsInfinity(ageMs) || Double.IsNaN(distancePx) || Double.IsInfinity(distancePx) || Double.IsNaN(speedPxPerMs) || Double.IsInfinity(speedPxPerMs)) return 0;
            if (ageMs < 0 || ageMs >= DurationMs || speedPxPerMs <= 0 || distancePx < 0) return 0;
            double crossing = ageMs - distancePx / speedPxPerMs;
            if (crossing < -28 || crossing > 520) return 0;
            double glint = crossing < 0 ? Smooth((crossing + 28) / 28) : Math.Exp(-crossing / 105);
            return glint * Smooth(ageMs / 80) * Math.Exp(-ageMs / 2600) * Smooth((DurationMs - ageMs) / 300);
        }
        private static double Smooth(double value) { double t = Math.Max(0, Math.Min(1, value)); return t * t * (3 - 2 * t); }
        private static long UtcNowMs() { return (DateTime.UtcNow.Ticks - 621355968000000000L) / TimeSpan.TicksPerMillisecond; }

        private static bool IsDock(IntPtr window)
        {
            if (window == IntPtr.Zero || !Native.IsWindow(window) || !Native.IsWindowVisible(window) || Native.IsIconic(window)) return false;
            StringBuilder title = new StringBuilder(80); Native.GetWindowText(window, title, title.Capacity);
            return String.Equals(title.ToString(), "Dock/Taskbar", StringComparison.Ordinal) && !Native.Cloaked(window);
        }

        private static bool SafeToDecorate(Surface surface)
        {
            if (!IsDock(surface.Dock) || surface.Bounds.IsEmpty || surface.Rim == null) return false;
            Rectangle[] protectedScreen = ProtectedOverlaps(surface);
            foreach (PointF point in surface.Rim)
            {
                if (!ProtectedPoint(surface.Bounds.X + point.X, surface.Bounds.Y + point.Y, protectedScreen)) return true;
            }
            return false;
        }

        private static bool ProtectedPoint(double x, double y, Rectangle[] rectangles)
        {
            foreach (Rectangle rectangle in rectangles)
                if (x >= rectangle.Left && x < rectangle.Right && y >= rectangle.Top && y < rectangle.Bottom) return true;
            return false;
        }

        private static Rectangle[] ProtectedOverlaps(Surface surface)
        {
            // Only actual higher z-order windows protect pixels. A foreground
            // app behind the dock must not suppress its still-visible rim.
            List<Rectangle> rectangles = new List<Rectangle>();
            uint ownProcess = Native.GetCurrentProcessId();
            IntPtr above = Native.GetWindow(surface.Dock, 3);
            for (int count = 0; above != IntPtr.Zero && count < 128; count++, above = Native.GetWindow(above, 3))
            {
                if (above == surface.Window.Handle || !Native.IsWindowVisible(above) || Native.IsIconic(above) || Native.Cloaked(above)) continue;
                uint owner; Native.GetWindowThreadProcessId(above, out owner);
                if (owner == ownProcess)
                {
                    StringBuilder title = new StringBuilder(80); Native.GetWindowText(above, title, title.Capacity);
                    if (title.ToString() == "Galaxy Atlas dock glint") continue;
                }
                Rectangle bounds = Native.VisibleBounds(above);
                Rectangle overlap = Rectangle.Intersect(surface.Bounds, bounds);
                if (!overlap.IsEmpty && overlap.Width > 0 && overlap.Height > 0 && !rectangles.Contains(overlap)) rectangles.Add(overlap);
            }
            if (above != IntPtr.Zero) rectangles.Add(surface.Bounds); // Unknown z-order tail: fail closed.
            return rectangles.ToArray();
        }

        private static GraphicsPath RoundedPath(int width, int height, double topRadius, double bottomRadius, double inset)
        {
            float x = (float)inset, y = (float)inset, w = Math.Max(1, width - 2 * x), h = Math.Max(1, height - 2 * y);
            float top = (float)Math.Max(.5, Math.Min(Math.Min(w / 2, h / 2), topRadius - inset));
            float bottom = (float)Math.Max(.5, Math.Min(Math.Min(w / 2, h / 2), bottomRadius - inset));
            GraphicsPath path = new GraphicsPath();
            path.AddArc(x, y, top * 2, top * 2, 180, 90); path.AddArc(x + w - top * 2, y, top * 2, top * 2, 270, 90);
            path.AddArc(x + w - bottom * 2, y + h - bottom * 2, bottom * 2, bottom * 2, 0, 90); path.AddArc(x, y + h - bottom * 2, bottom * 2, bottom * 2, 90, 90); path.CloseFigure(); return path;
        }

        private static PointF[] BuildRim(int width, int height, double scale)
        {
            using (GraphicsPath rim = RoundedPath(width, height, 28 * scale, 18 * scale, Math.Max(.8, scale * .75)))
            {
                rim.Flatten(null, (float)(.65 * scale)); PointF[] vertices = rim.PathPoints; List<PointF> points = new List<PointF>();
                for (int index = 0; index < vertices.Length; index++)
                {
                    PointF a = vertices[index], b = vertices[(index + 1) % vertices.Length]; double dx = b.X - a.X, dy = b.Y - a.Y;
                    int count = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(dx * dx + dy * dy) / (3 * scale)));
                    for (int step = 0; step < count; step++) points.Add(new PointF((float)(a.X + dx * step / count), (float)(a.Y + dy * step / count)));
                }
                return points.ToArray();
            }
        }

        private sealed class Wave
        {
            public readonly Point Origin; public readonly long Start; public readonly double Speed, InitialAge;
            private readonly Stopwatch watch = Stopwatch.StartNew();
            public Wave(Point origin, long start, double speed, double age) { Origin = origin; Start = start; Speed = speed; InitialAge = age; }
            public double Age { get { return InitialAge + watch.Elapsed.TotalMilliseconds; } }
        }

        private sealed class Surface : IDisposable
        {
            public readonly IntPtr Dock; public readonly GlintWindow Window = new GlintWindow();
            public readonly List<Wave> Waves = new List<Wave>(); public Rectangle Bounds; public double Scale = 1; public PointF[] Rim;
            private AutomationElement toolbar; private long measuredAt;
            public Surface(IntPtr dock) { Dock = dock; }
            public bool Measure(bool force)
            {
                if (!force && UtcNowMs() - measuredAt < 160) return Bounds.Width > 0;
                measuredAt = UtcNowMs();
                try
                {
                    if (toolbar == null) toolbar = AutomationElement.FromHandle(Dock).FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ToolBar));
                    Rectangle next = ToolbarBounds(Dock, toolbar); uint dpi = Native.GetDpiForWindow(Dock); Scale = dpi > 0 ? dpi / 96.0 : 1;
                    if (next.IsEmpty) { Bounds = Rectangle.Empty; return false; }
                    if (next != Bounds || Rim == null)
                    {
                        Bounds = next;
                        Rim = BuildRim(next.Width, next.Height, Scale);
                    }
                    return true;
                }
                catch { toolbar = null; Bounds = Rectangle.Empty; return false; }
            }
            public void Hide() { Window.Hide(); }
            public void Dispose() { Window.Dispose(); }
        }

        private sealed class GlintWindow : NativeWindow, IDisposable
        {
            private bool shown;
            public GlintWindow()
            {
                CreateParams create = new CreateParams(); create.Caption = "Galaxy Atlas dock glint";
                create.Style = unchecked((int)0x88000000); // WS_POPUP | WS_DISABLED: no input recipient.
                create.ExStyle = 0x00080000 | 0x00000020 | 0x08000000 | 0x00000080;
                CreateHandle(create);
            }
            public void Present(Bitmap image, Rectangle bounds)
            {
                IntPtr screen = IntPtr.Zero, memory = IntPtr.Zero, bitmap = IntPtr.Zero, previous = IntPtr.Zero;
                try
                {
                    screen = Native.GetDC(IntPtr.Zero); memory = Native.CreateCompatibleDC(screen);
                    if (screen == IntPtr.Zero || memory == IntPtr.Zero) { Hide(); return; }
                    bitmap = image.GetHbitmap(Color.FromArgb(0)); previous = Native.SelectObject(memory, bitmap);
                    Native.POINT at = new Native.POINT(bounds.X, bounds.Y), origin = new Native.POINT(0, 0); Native.SIZE size = new Native.SIZE(bounds.Width, bounds.Height);
                    Native.BLENDFUNCTION blend = new Native.BLENDFUNCTION(); blend.SourceConstantAlpha = 255; blend.AlphaFormat = 1;
                    if (!Native.UpdateLayeredWindow(Handle, screen, ref at, ref size, memory, ref origin, 0, ref blend, 2)) { Hide(); return; }
                    Native.SetWindowPos(Handle, new IntPtr(-1), bounds.X, bounds.Y, bounds.Width, bounds.Height, 0x0010 | 0x0040); shown = true;
                }
                finally { if (previous != IntPtr.Zero) Native.SelectObject(memory, previous); if (bitmap != IntPtr.Zero) Native.DeleteObject(bitmap); if (memory != IntPtr.Zero) Native.DeleteDC(memory); if (screen != IntPtr.Zero) Native.ReleaseDC(IntPtr.Zero, screen); }
            }
            public void Hide() { if (shown) Native.ShowWindow(Handle, 0); shown = false; }
            public void Dispose() { Hide(); DestroyHandle(); }
        }

        public void Dispose()
        {
            if (disposed) return; disposed = true; Cancel(); timer.Tick -= Tick; timer.Dispose();
            foreach (Surface surface in surfaces.Values) surface.Dispose(); surfaces.Clear();
        }

        private static class Native
        {
            [StructLayout(LayoutKind.Sequential)] internal struct RECT { internal int Left, Top, Right, Bottom; internal Rectangle Rectangle { get { return System.Drawing.Rectangle.FromLTRB(Left, Top, Right, Bottom); } } }
            [StructLayout(LayoutKind.Sequential)] internal struct POINT { internal int X, Y; internal POINT(int x, int y) { X = x; Y = y; } }
            [StructLayout(LayoutKind.Sequential)] internal struct SIZE { internal int Width, Height; internal SIZE(int width, int height) { Width = width; Height = height; } }
            [StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct BLENDFUNCTION { internal byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
            [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
            [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
            [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
            [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")] internal static extern IntPtr GetWindow(IntPtr window, uint command);
            [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
            [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
            [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);
            [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);
            [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong32(IntPtr window, int index);
            internal static IntPtr GetWindowLongPtr(IntPtr window, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : new IntPtr(GetWindowLong32(window, index)); }
            [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
            [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int DwmGetFrameBounds(IntPtr window, int attribute, out RECT value, int size);
            internal static bool Cloaked(IntPtr window) { int value; return DwmGetWindowAttribute(window, 14, out value, 4) == 0 && value != 0; }
            internal static Rectangle VisibleBounds(IntPtr window)
            {
                RECT value;
                if (DwmGetFrameBounds(window, 9, out value, Marshal.SizeOf(typeof(RECT))) == 0 && value.Right > value.Left && value.Bottom > value.Top) return value.Rectangle;
                return GetWindowRect(window, out value) ? value.Rectangle : Rectangle.Empty;
            }
            [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr window);
            [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr window, IntPtr dc);
            [DllImport("gdi32.dll")] internal static extern IntPtr CreateCompatibleDC(IntPtr dc);
            [DllImport("gdi32.dll")] internal static extern bool DeleteDC(IntPtr dc);
            [DllImport("gdi32.dll")] internal static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
            [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr item);
            [DllImport("user32.dll")] internal static extern bool UpdateLayeredWindow(IntPtr window, IntPtr targetDc, ref POINT target, ref SIZE size, IntPtr sourceDc, ref POINT source, int key, ref BLENDFUNCTION blend, int flags);
            [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
            [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
        }
    }
}
