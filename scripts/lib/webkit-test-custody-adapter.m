// Synthetic headless Playwright embedder only. Never linked into Freed.
// Supply the missing Cocoa embedder callback; WebKit's key wrap/unwrap,
// IndexedDB serialization and JavaScript extractability checks are unchanged.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <unistd.h>

static NSData *fixtureKey;
static id masterKey(id self, SEL command, id view) { return fixtureKey; }
static void masterKeyAsync(id self, SEL command, id view, void (^completion)(NSData *)) { completion(fixtureKey); }

static void refuse(void) {
    fprintf(stderr, "Synthetic WebKit custody adapter refused invalid fixture state\n");
    _exit(78);
}

__attribute__((constructor)) static void installFixture(void) {
    @autoreleasepool {
        if (![[NSBundle mainBundle].bundleIdentifier isEqualToString:@"org.webkit.Playwright"]) return;
        const char *expected = getenv("FREED_WEBKIT_TEST_BROWSER_BINARY");
        char executable[PATH_MAX], resolved[PATH_MAX];
        uint32_t size = sizeof(executable);
        if (!expected || _NSGetExecutablePath(executable, &size) || !realpath(executable, resolved) || strcmp(expected, resolved)) return;

        const char *keyPath = getenv("FREED_WEBKIT_TEST_MASTER_KEY_FILE");
        const char *receiptPath = getenv("FREED_WEBKIT_TEST_ADAPTER_RECEIPT_FILE");
        if (!keyPath || !receiptPath) refuse();
        NSString *parent = [[NSString stringWithUTF8String:keyPath] stringByDeletingLastPathComponent];
        if (![parent isEqualToString:[[NSString stringWithUTF8String:receiptPath] stringByDeletingLastPathComponent]]) refuse();
        struct stat directory;
        if (lstat(parent.fileSystemRepresentation, &directory) || !S_ISDIR(directory.st_mode) || directory.st_uid != getuid() || (directory.st_mode & 0777) != 0700) refuse();
        int descriptor = open(keyPath, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
        struct stat metadata;
        if (descriptor < 0 || fstat(descriptor, &metadata) || !S_ISREG(metadata.st_mode) || metadata.st_uid != getuid() || (metadata.st_mode & 0777) != 0600 || metadata.st_size != 16) refuse();
        unsigned char bytes[16];
        if (read(descriptor, bytes, sizeof(bytes)) != sizeof(bytes)) refuse();
        close(descriptor);
        fixtureKey = [NSData dataWithBytes:bytes length:sizeof(bytes)];
        volatile unsigned char *wipe = bytes;
        for (size_t index = 0; index < sizeof(bytes); index++) wipe[index] = 0;

        unsigned installed = 0;
        for (NSString *name in @[@"BrowserAppDelegate", @"BrowserWindowController"]) {
            Class delegate = NSClassFromString(name);
            SEL sync = NSSelectorFromString(@"_webCryptoMasterKeyForWebView:");
            SEL async = NSSelectorFromString(@"_webCryptoMasterKeyForWebView:completionHandler:");
            if (!delegate) continue;
            // Never replace an existing platform custody implementation.
            if (class_getInstanceMethod(delegate, sync) || class_getInstanceMethod(delegate, async)) continue;
            if (!class_addMethod(delegate, sync, (IMP)masterKey, "@@:@") || !class_addMethod(delegate, async, (IMP)masterKeyAsync, "v@:@@?")) refuse();
            installed++;
        }
        if (!installed) refuse();
        int receipt = open(receiptPath, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        const char message[] = "freed-webkit-custody-adapter-v1\n";
        if (receipt < 0 || write(receipt, message, sizeof(message) - 1) != sizeof(message) - 1) refuse();
        close(receipt);
    }
}
