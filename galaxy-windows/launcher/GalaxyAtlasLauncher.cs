using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("Galaxy Atlas")]
[assembly: AssemblyDescription("Show the existing Galaxy Atlas desktop and return to its home view.")]
[assembly: AssemblyProduct("Galaxy Atlas")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class GalaxyAtlasHomeLauncher
{
    private static readonly string LocalRoot = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string RoamingRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    private static readonly string Cli = LocalRoot + @"\Microsoft\WindowsApps\slu.exe";
    private static readonly string CommandDirectory = RoamingRoot + @"\com.seelen.seelen-ui\data\galaxy-atlas-desktop";
    private static readonly string CommandFile = CommandDirectory + @"\mouse-command.json";

    // Exit codes: 0 = Home command consumed; 2 = unexpected arguments; 3 = installation
    // unavailable; 4 = host not running; 5 = another invocation busy;
    // 6 = CLI failure/timeout; 7 = no acknowledgement; 8 = replaced command;
    // 1 = file or operating-system failure.
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 0) return 2;
        try
        {
            if (!SamePath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), LocalRoot)
                || !SamePath(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), RoamingRoot)
                || !SamePath(Path.GetDirectoryName(CommandFile), CommandDirectory)
                || !File.Exists(Cli) || !Directory.Exists(CommandDirectory)) return 3;

            // This helper never starts, stops or duplicates the Seelen host.
            if (!HostIsRunning()) return 4;
            Stopwatch elapsed = Stopwatch.StartNew();
            using (Mutex gate = new Mutex(false, @"Local\GalaxyAtlas.Desktop.ShowHome.v1"))
            {
                bool held = false;
                try
                {
                    try { held = gate.WaitOne(3000); }
                    catch (AbandonedMutexException) { held = true; }
                    if (!held) return 5;
                    if (!HostIsRunning()) return 4;

                    string previousPayload = null;
                    for (int attempt = 0; attempt < 3 && elapsed.ElapsedMilliseconds < 25000; attempt++)
                    {
                        if (!HostIsRunning()) return 4;
                        if (previousPayload != null)
                        {
                            int previousState = ReadCommandState(previousPayload);
                            if (previousState == 0) return 0;
                            if (previousState == 8) return 8;
                        }
                        string nonce = Guid.NewGuid().ToString("N");
                        long unixMilliseconds = (DateTime.UtcNow.Ticks - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).Ticks) / TimeSpan.TicksPerMillisecond;
                        string payload = "{\"version\":1,\"action\":\"home\",\"nonce\":\"" + nonce
                            + "\",\"at\":" + unixMilliseconds.ToString(CultureInfo.InvariantCulture) + "}";
                        WriteCommand(payload, nonce);
                        previousPayload = payload;
                        if (!TriggerHome((int)Math.Min(5000, Math.Max(1, 25000 - elapsed.ElapsedMilliseconds)))) return 6;
                        long acknowledgementDeadline = Math.Min(25000, elapsed.ElapsedMilliseconds + 6000);
                        while (elapsed.ElapsedMilliseconds < acknowledgementDeadline)
                        {
                            int state = ReadCommandState(payload);
                            if (state == 0 || state == 8) return state;
                            Thread.Sleep((int)Math.Min(100, Math.Max(1, acknowledgementDeadline - elapsed.ElapsedMilliseconds)));
                        }
                    }
                    return previousPayload != null && ReadCommandState(previousPayload) == 0 ? 0 : 7;
                }
                finally { if (held) gate.ReleaseMutex(); }
            }
        }
        catch { return 1; }
    }

    private static bool TriggerHome(int timeout)
    {
        ProcessStartInfo start = new ProcessStartInfo(Cli, "widget trigger \"@galaxy-atlas/desktop\"");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.WorkingDirectory = Path.GetDirectoryName(Cli);
        using (Process child = Process.Start(start))
        {
            return child != null && child.WaitForExit(timeout) && child.ExitCode == 0;
        }
    }

    // The desktop acknowledges consumption by clearing this exact small file.
    // Never inspect unrelated data or overwrite a different pending action.
    private static int ReadCommandState(string expectedPayload)
    {
        try
        {
            if (!File.Exists(CommandFile)) return 7;
            string current = File.ReadAllText(CommandFile, Encoding.UTF8).Trim();
            if (current == "{}") return 0;
            if (current.Length == 0 || current == expectedPayload) return 7;
            return 8;
        }
        catch (IOException) { return 7; }
    }

    private static bool SamePath(string actual, string expected)
    {
        return string.Equals(Path.GetFullPath(actual).TrimEnd(Path.DirectorySeparatorChar),
            Path.GetFullPath(expected).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
    }

    private static bool HostIsRunning()
    {
        bool running = false;
        foreach (Process process in Process.GetProcessesByName("seelen-ui"))
        {
            using (process)
            {
                try { if (!process.HasExited) running = true; }
                catch (InvalidOperationException) { }
            }
        }
        return running;
    }

    private static void WriteCommand(string payload, string nonce)
    {
        string temporary = CommandFile + ".home-" + nonce + ".tmp";
        try
        {
            File.WriteAllText(temporary, payload, new UTF8Encoding(false));
            if (File.Exists(CommandFile)) File.Replace(temporary, CommandFile, null);
            else File.Move(temporary, CommandFile);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
