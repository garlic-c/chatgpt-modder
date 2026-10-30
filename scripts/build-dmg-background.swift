import AppKit

// Assemble the installation UI over the user's unchanged background artwork.
// Finder supplies the actual app and Applications icons and their labels.
let args = CommandLine.arguments
let source = NSImage(contentsOfFile: args[1])!
let destination = URL(fileURLWithPath: args[2], isDirectory: true)
for scale in [1, 2] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil, pixelsWide:768*scale, pixelsHigh:592*scale,
        bitsPerSample:8, samplesPerPixel:4, hasAlpha:true, isPlanar:false,
        colorSpaceName:.deviceRGB, bytesPerRow:0, bitsPerPixel:0)!
    bitmap.size = NSSize(width:768, height:592)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep:bitmap)!
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x:CGFloat(scale), y:CGFloat(scale))
    // Extend only the empty installation canvas; preserve the original artwork.
    let edge = NSBitmapImageRep(data:try Data(contentsOf:URL(fileURLWithPath:args[1])))!
    let left = edge.colorAt(x:0,y:edge.pixelsHigh-1)!
    let right = edge.colorAt(x:edge.pixelsWide-1,y:edge.pixelsHigh-1)!
    NSGradient(starting:left,ending:right)!.draw(in:NSRect(x:0,y:0,width:768,height:80),angle:0)
    source.draw(in:NSRect(x:0,y:80,width:768,height:512))
    let arrow = NSBezierPath()
    let points: [(Double,Double)] = [(354,215),(390,215),(390,197),(416,224),(390,251),(390,233),(354,233)]
    for (index, point) in points.enumerated() {
        let p = NSPoint(x:point.0,y:592-(point.1-40))
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
