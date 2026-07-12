//! The tray dot: green while a session is blocking, gray while idle.
//!
//! Drawn in code rather than shipped as .png assets so the two states cannot
//! drift apart and there is nothing extra to bundle. 3x supersampling gives
//! the edge its antialiasing.

use tauri::image::Image;

const SIZE: u32 = 32;
const SS: u32 = 3;

const CENTER: f32 = SIZE as f32 / 2.0;
const RADIUS: f32 = 12.0;
/// Inner edge of the soft white rim that lifts the dot off dark taskbars.
const RIM_INNER: f32 = 11.0;
const RIM_ALPHA: f32 = 110.0 / 255.0;

const GREEN: (u8, u8, u8) = (46, 204, 113);
const GRAY: (u8, u8, u8) = (130, 130, 130);

/// A filled circle in `rgb`, transparent outside.
fn dot(rgb: (u8, u8, u8)) -> Image<'static> {
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let (mut r, mut g, mut b, mut covered) = (0.0f32, 0.0f32, 0.0f32, 0u32);

            for sy in 0..SS {
                for sx in 0..SS {
                    let px = x as f32 + (sx as f32 + 0.5) / SS as f32;
                    let py = y as f32 + (sy as f32 + 0.5) / SS as f32;
                    let d = ((px - CENTER).powi(2) + (py - CENTER).powi(2)).sqrt();
                    if d > RADIUS {
                        continue;
                    }

                    // Blend the white rim over the base color near the edge.
                    let t = if d >= RIM_INNER { RIM_ALPHA } else { 0.0 };
                    r += rgb.0 as f32 * (1.0 - t) + 255.0 * t;
                    g += rgb.1 as f32 * (1.0 - t) + 255.0 * t;
                    b += rgb.2 as f32 * (1.0 - t) + 255.0 * t;
                    covered += 1;
                }
            }

            if covered == 0 {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            let n = covered as f32;
            let alpha = (covered as f32 / (SS * SS) as f32 * 255.0).round() as u8;
            rgba.extend_from_slice(&[
                (r / n).round() as u8,
                (g / n).round() as u8,
                (b / n).round() as u8,
                alpha,
            ]);
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

/// Green: a session is running and sites are blocked.
pub fn active() -> Image<'static> {
    dot(GREEN)
}

/// Gray: nothing is being blocked.
pub fn idle() -> Image<'static> {
    dot(GRAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(img: &Image<'_>, x: u32, y: u32) -> (u8, u8, u8, u8) {
        let i = ((y * SIZE + x) * 4) as usize;
        let p = img.rgba();
        (p[i], p[i + 1], p[i + 2], p[i + 3])
    }

    #[test]
    fn dot_is_opaque_in_the_middle_and_clear_in_the_corners() {
        let img = active();
        assert_eq!(img.width(), SIZE);
        assert_eq!(img.height(), SIZE);

        let (r, g, b, a) = pixel(&img, SIZE / 2, SIZE / 2);
        assert_eq!((r, g, b), GREEN, "center should be the pure dot color");
        assert_eq!(a, 255, "center should be fully opaque");

        for (x, y) in [(0, 0), (SIZE - 1, 0), (0, SIZE - 1), (SIZE - 1, SIZE - 1)] {
            assert_eq!(pixel(&img, x, y).3, 0, "corner {x},{y} should be transparent");
        }
    }

    #[test]
    fn the_two_states_are_actually_different() {
        let (active_center, idle_center) = (
            pixel(&active(), SIZE / 2, SIZE / 2),
            pixel(&idle(), SIZE / 2, SIZE / 2),
        );
        assert_ne!(active_center, idle_center);
    }
}
