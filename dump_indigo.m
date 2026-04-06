#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <CoreGraphics/CoreGraphics.h>
#include <mach/mach.h>
#include <malloc/malloc.h>

// Forward declare the public macOS C functions exported by SimulatorKit
typedef void* (*IndigoHIDMessageForMouseNSEvent_t)(CGPoint *p0, CGPoint *p1, int target, NSUInteger eventType, CGSize size, int edge);

int main() {
    // Attempt to dynamically load SimulatorKit directly from macOS frameworks
    const char *simKitPath = "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit";
    void *simKitHandle = dlopen(simKitPath, RTLD_LAZY | RTLD_GLOBAL);
    
    if (!simKitHandle) {
        printf("ERROR: Failed to load SimulatorKit from %s\n", simKitPath);
        return 1;
    }
    
    // Extract the exact builder function used to translate a touch event to the proprietary IndigoMessage
    IndigoHIDMessageForMouseNSEvent_t IndigoHIDMessageForMouseNSEvent = 
        (IndigoHIDMessageForMouseNSEvent_t)dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent");
        
    if (!IndigoHIDMessageForMouseNSEvent) {
        printf("ERROR: Could not find IndigoHIDMessageForMouseNSEvent in SimulatorKit\n");
        return 1;
    }
    
    // We create dummy parameters to feed into the function
    CGPoint p0 = CGPointMake(100.0, 200.0);
    CGPoint p1 = CGPointMake(0.0, 0.0);
    int target = 0x32;
    NSUInteger eventType = 1; // MouseEventDown
    CGSize size = CGSizeMake(1000, 2000);
    int edge = 0;
    
    // Convert it to the undocumented Indigo Message!
    void *indigoMessage = IndigoHIDMessageForMouseNSEvent(&p0, &p1, target, eventType, size, edge);
    
    if (!indigoMessage) {
        printf("ERROR: IndigoHIDMessageForMouseNSEvent returned NULL\n");
        return 1;
    }
    
    uint32_t size_bytes = malloc_size(indigoMessage);
    
    printf("\n=== SUCCESS: IndigoHIDMessage Extracted ===\n");
    printf("Total C-Struct Size: %u bytes\n", size_bytes);
    
    // Hex dump the entire struct memory so we can see the exact offsets for the X/Y coordinates
    printf("Raw Memory Hex Dump:\n");
    unsigned char *bytes = (unsigned char *)indigoMessage;
    for (int i = 0; i < size_bytes; i++) {
        printf("%02X ", bytes[i]);
        if ((i + 1) % 16 == 0) printf("\n");
    }
    printf("\n");
    
    // Clean up
    free(indigoMessage);
    dlclose(simKitHandle);
    
    return 0;
}
