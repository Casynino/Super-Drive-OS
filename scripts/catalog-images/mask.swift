// Finds the foreground objects in a photo using macOS Vision and saves one black/white mask per object.
// usage: mask <input.jpg> <output-prefix>
import Foundation
import Vision
import CoreImage

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: mask <input> <outPrefix>"); exit(1) }
guard let image = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true]) else {
    print("cannot read \(args[1])"); exit(1)
}
let handler = VNImageRequestHandler(ciImage: image, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { print("no foreground found"); exit(0) }
let context = CIContext()
for index in result.allInstances {
    let buffer = try result.generateScaledMaskForImage(forInstances: IndexSet(integer: index), from: handler)
    let mask = CIImage(cvPixelBuffer: buffer)
    try context.writePNGRepresentation(of: mask, to: URL(fileURLWithPath: "\(args[2])_inst\(index).png"), format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
}
print("\(result.allInstances.count) object(s) found")
