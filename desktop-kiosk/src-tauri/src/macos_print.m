#import <Cocoa/Cocoa.h>
#import <PDFKit/PDFKit.h>

int macos_print_pdf(
    const char *printer_name,
    const char *pdf_path,
    int copies,
    int is_duplex,
    int is_landscape,
    const char *paper_size
) {
    @autoreleasepool {
        if (!printer_name || !pdf_path) {
            return -1;
        }
        
        NSString *pName = [NSString stringWithUTF8String:printer_name];
        NSString *path = [NSString stringWithUTF8String:pdf_path];
        
        NSURL *url = [NSURL fileURLWithPath:path];
        PDFDocument *doc = [[PDFDocument alloc] initWithURL:url];
        if (!doc) {
            return -2;
        }
        
        NSPrinter *printer = [NSPrinter printerWithName:pName];
        if (!printer) {
            NSString *cleanPName = [pName stringByReplacingOccurrencesOfString:@"_" withString:@" "];
            for (NSString *available in [NSPrinter printerNames]) {
                NSString *cleanAvail = [available stringByReplacingOccurrencesOfString:@"_" withString:@" "];
                if ([available caseInsensitiveCompare:pName] == NSOrderedSame ||
                    [cleanAvail caseInsensitiveCompare:cleanPName] == NSOrderedSame) {
                    printer = [NSPrinter printerWithName:available];
                    break;
                }
            }
        }
        if (!printer) {
            return -3;
        }
        
        NSPrintInfo *printInfo = [[NSPrintInfo sharedPrintInfo] copy];
        [printInfo setPrinter:printer];
        
        NSMutableDictionary *dict = [printInfo dictionary];
        [dict setObject:@(copies > 0 ? copies : 1) forKey:NSPrintCopies];
        
        if (paper_size && strlen(paper_size) > 0) {
            NSString *paperStr = [NSString stringWithUTF8String:paper_size];
            if ([paperStr caseInsensitiveCompare:@"A4"] == NSOrderedSame) {
                [printInfo setPaperName:@"iso-a4"];
            } else if ([paperStr caseInsensitiveCompare:@"Letter"] == NSOrderedSame) {
                [printInfo setPaperName:@"na-letter"];
            } else if ([paperStr caseInsensitiveCompare:@"Legal"] == NSOrderedSame) {
                [printInfo setPaperName:@"na-legal"];
            } else if ([paperStr caseInsensitiveCompare:@"A3"] == NSOrderedSame) {
                [printInfo setPaperName:@"iso-a3"];
            }
        }
        
        [printInfo setOrientation:is_landscape ? NSPaperOrientationLandscape : NSPaperOrientationPortrait];
        [printInfo setHorizontallyCentered:YES];
        [printInfo setVerticallyCentered:YES];
        
        if (is_duplex) {
            [dict setObject:@(2) forKey:@"NSPrintDuplex"];
        } else {
            [dict setObject:@(1) forKey:@"NSPrintDuplex"];
        }
        
        NSPrintOperation *op = [doc printOperationForPrintInfo:printInfo 
                                                   scalingMode:kPDFPrintPageScaleToFit 
                                                    autoRotate:YES];
        if (!op) {
            return -4;
        }
        
        [op setShowsPrintPanel:NO];
        [op setShowsProgressPanel:NO];
        
        BOOL success = [op runOperation];
        return success ? 0 : -5;
    }
}
