import AppKit

// Assemble the installation UI over the user's unchanged background artwork.
// Finder supplies the actual app and Applications icons and their labels.
let args = CommandLine.arguments
let source = NSImage(contentsOfFile: args[1])!
let destination = URL(fileURLWithPath: args[2], isDirectory: true)
let extended = NSImage(contentsOfFile: URL(fileURLWithPath: args[1]).deletingLastPathComponent().appendingPathComponent("background-extended.png").path)!
for scale in [1, 2] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil, pixelsWide:768*scale, pixelsHigh:602*scale,
        bitsPerSample:8, samplesPerPixel:4, hasAlpha:true, isPlanar:false,
        colorSpaceName:.deviceRGB, bytesPerRow:0, bitsPerPixel:0)!
    bitmap.size = NSSize(width:768, height:602)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep:bitmap)!
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x:CGFloat(scale), y:CGFloat(scale))
    // Generated blanket folds fill the full expanded canvas. Preserve the source
    // portrait and typography; blend only its last empty 37pt into the outpaint.
    extended.draw(in:NSRect(x:0,y:0,width:768,height:602))
    let cg = context.cgContext
    cg.saveGState()
    cg.beginTransparencyLayer(auxiliaryInfo:nil)
    source.draw(in:NSRect(x:0,y:90,width:768,height:512))
    cg.setBlendMode(.destinationIn)
    let mask = CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(), colors:[
        CGColor(gray:1,alpha:0), CGColor(gray:1,alpha:1)
    ] as CFArray, locations:[0,1])!
    cg.drawLinearGradient(mask,start:CGPoint(x:0,y:90),end:CGPoint(x:0,y:127),options:[.drawsBeforeStartLocation,.drawsAfterEndLocation])
    cg.endTransparencyLayer()
    cg.restoreGState()
    let arrow = NSBezierPath()
    let points: [(Double,Double)] = [(354,215),(390,215),(390,197),(416,224),(390,251),(390,233),(354,233)]
    for (index, point) in points.enumerated() {
        let p = NSPoint(x:point.0,y:602-(point.1-40))
        if index == 0 { arrow.move(to:p) } else { arrow.line(to:p) }
    }
    arrow.close()
    NSColor(calibratedWhite:1, alpha:0.8).set()
    arrow.lineWidth = 5
    arrow.lineJoinStyle = .round
    arrow.fill()
    arrow.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "background.png" : "background@2x.png"
    try bitmap.representation(using:.png,properties:[:])!.write(to:destination.appendingPathComponent(name))
}
