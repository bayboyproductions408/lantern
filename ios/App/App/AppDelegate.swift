import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        return true
    }

    /// Lets narration keep playing when the screen locks or the app is
    /// backgrounded.
    ///
    /// This is half of a pair. UIBackgroundModes=audio in Info.plist buys the
    /// right to run in the background; the session category is what actually
    /// keeps audio alive once there. Either alone does nothing, which is why
    /// the bug was easy to miss - build 16 had neither, and a comment in
    /// js/narration.js claimed the playsinline attribute covered it. It does
    /// not: playsinline only stops video taking over the screen.
    ///
    /// .spokenAudio is the mode for narration rather than music. It makes the
    /// system treat this as an audiobook, following the Spoken Audio routing
    /// and ducking rules instead of the music ones.
    ///
    /// The category is set but the session is deliberately NOT activated here.
    /// Activating claims the audio route straight away, which would cut off
    /// whatever the listener was already playing just because they opened the
    /// app. iOS activates it by itself when playback actually starts.
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        } catch {
            // Non-fatal: foreground playback still works, so a failure here
            // must never stop the app from launching.
            print("Lantern: could not set audio session category - \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
