import CoreGraphics

/// The inherited spring model integrates in AppKit coordinates while the glyph
/// dynamics use a y-down coordinate system. Keep this conversion at the adapter
/// boundary rather than modifying the recovered motion equations.
func visualCursorScreenStateVelocity(
    fromRuntimeVelocity velocity: CGVector,
    yAxisMultiplier: CGFloat
) -> CGVector {
    CGVector(dx: velocity.dx, dy: velocity.dy * yAxisMultiplier)
}
