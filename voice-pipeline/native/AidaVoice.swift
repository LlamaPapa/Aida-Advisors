import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let port: Int

    init(port: Int) {
        self.port = port
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Configure WKWebView with mic permissions
        let webConfig = WKWebViewConfiguration()
        webConfig.mediaTypesRequiringUserActionForPlayback = []

        // Allow inline media playback
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        webConfig.defaultWebpagePreferences = prefs

        webView = WKWebView(frame: .zero, configuration: webConfig)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self as? WKNavigationDelegate

        // Create window
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 420, height: 700)
        let windowWidth: CGFloat = 420
        let windowHeight: CGFloat = 700
        let windowX = screenFrame.maxX - windowWidth - 20
        let windowY = screenFrame.maxY - windowHeight - 20

        window = NSWindow(
            contentRect: NSRect(x: windowX, y: windowY, width: windowWidth, height: windowHeight),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "AIDA Voice"
        window.contentView = webView
        window.minSize = NSSize(width: 340, height: 500)
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.04, alpha: 1)

        // Titlebar styling for dark appearance
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)

        // Wait for daemon to be ready, then load
        waitForDaemon {
            let url = URL(string: "http://localhost:\(self.port)")!
            self.webView.load(URLRequest(url: url))
            self.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func waitForDaemon(completion: @escaping () -> Void) {
        let url = URL(string: "http://localhost:\(port)/api/health")!
        var attempts = 0
        let maxAttempts = 40 // 40 * 0.3s = 12s max wait

        func check() {
            attempts += 1
            let task = URLSession.shared.dataTask(with: url) { data, response, error in
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    DispatchQueue.main.async { completion() }
                } else if attempts < maxAttempts {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { check() }
                } else {
                    // Timeout — try loading anyway
                    DispatchQueue.main.async { completion() }
                }
            }
            task.resume()
        }
        check()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

// Parse port from command line args
var port = 7890
for (i, arg) in CommandLine.arguments.enumerated() {
    if (arg == "-p" || arg == "--port"), i + 1 < CommandLine.arguments.count,
       let p = Int(CommandLine.arguments[i + 1]) {
        port = p
    }
}

let app = NSApplication.shared
let delegate = AppDelegate(port: port)
app.delegate = delegate
app.run()
