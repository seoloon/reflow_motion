//! Every encoding option ReFlow exposes for `remotion render`, with validation per codec and the
//! translation to command-line arguments. Option names follow the Remotion CLI so they can be looked up in its docs.

use serde::{Deserialize, Serialize};

macro_rules! cli_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident => $arg:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $( #[serde(rename = $arg)] $variant, )+
        }
        impl $name {
            pub fn as_arg(self) -> &'static str {
                match self { $( $name::$variant => $arg, )+ }
            }
        }
    };
}

cli_enum!(Codec {
    H264 => "h264",
    H264Mkv => "h264-mkv",
    H264Ts => "h264-ts",
    H265 => "h265",
    Vp8 => "vp8",
    Vp9 => "vp9",
    Prores => "prores",
    Gif => "gif",
    Mp3 => "mp3",
    Aac => "aac",
    Wav => "wav",
});

cli_enum!(PixelFormat {
    Yuv420p => "yuv420p",
    Yuva420p => "yuva420p",
    Yuv422p => "yuv422p",
    Yuv444p => "yuv444p",
    Yuv420p10le => "yuv420p10le",
    Yuv422p10le => "yuv422p10le",
    Yuv444p10le => "yuv444p10le",
    Yuva444p10le => "yuva444p10le",
});

cli_enum!(ColorSpace {
    Default => "default",
    Bt601 => "bt601",
    Bt709 => "bt709",
    Bt2020Ncl => "bt2020-ncl",
});

cli_enum!(ProresProfile {
    Proxy => "proxy",
    Light => "light",
    Standard => "standard",
    Hq => "hq",
    P4444 => "4444",
    P4444Xq => "4444-xq",
});

cli_enum!(X264Preset {
    Ultrafast => "ultrafast",
    Superfast => "superfast",
    Veryfast => "veryfast",
    Faster => "faster",
    Fast => "fast",
    Medium => "medium",
    Slow => "slow",
    Slower => "slower",
    Veryslow => "veryslow",
    Placebo => "placebo",
});

cli_enum!(AudioCodec {
    Aac => "aac",
    Mp3 => "mp3",
    Pcm16 => "pcm-16",
    Opus => "opus",
});

cli_enum!(ImageFormat {
    Png => "png",
    Jpeg => "jpeg",
    None => "none",
});

cli_enum!(HardwareAcceleration {
    Disable => "disable",
    IfPossible => "if-possible",
    Required => "required",
});

impl Codec {
    pub fn extension(self) -> &'static str {
        match self {
            Codec::H264 | Codec::H265 => "mp4",
            Codec::H264Mkv => "mkv",
            Codec::H264Ts => "ts",
            Codec::Vp8 | Codec::Vp9 => "webm",
            Codec::Prores => "mov",
            Codec::Gif => "gif",
            Codec::Mp3 => "mp3",
            Codec::Aac => "aac",
            Codec::Wav => "wav",
        }
    }
    pub fn is_audio_only(self) -> bool {
        matches!(self, Codec::Mp3 | Codec::Aac | Codec::Wav)
    }
    pub fn is_h264(self) -> bool {
        matches!(self, Codec::H264 | Codec::H264Mkv | Codec::H264Ts)
    }
    /// Valid CRF range, where the codec uses one.
    pub fn crf_range(self) -> Option<(u32, u32)> {
        match self {
            c if c.is_h264() => Some((1, 51)),
            Codec::H265 => Some((0, 51)),
            Codec::Vp8 => Some((4, 63)),
            Codec::Vp9 => Some((0, 63)),
            _ => None,
        }
    }
}

impl PixelFormat {
    pub fn has_alpha(self) -> bool {
        matches!(self, PixelFormat::Yuva420p | PixelFormat::Yuva444p10le)
    }
    pub fn is_10bit(self) -> bool {
        matches!(self, PixelFormat::Yuv420p10le | PixelFormat::Yuv422p10le | PixelFormat::Yuv444p10le | PixelFormat::Yuva444p10le)
    }
}

/// Everything about *how* a composition is encoded. All optional fields fall back to Remotion's defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderSettings {
    pub codec: Codec,
    /// Resolution multiplier (1 = composition size).
    #[serde(default = "one")]
    pub scale: f64,
    /// Override the composition's size / frame rate / length.
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub fps: Option<f64>,
    /// Inclusive frame range.
    #[serde(default)]
    pub frames: Option<(u32, u32)>,
    #[serde(default)]
    pub every_nth_frame: Option<u32>,

    // quality
    #[serde(default)]
    pub crf: Option<u32>,
    /// e.g. "8M", "2500k"; mutually exclusive with `crf`.
    #[serde(default)]
    pub video_bitrate: Option<String>,
    #[serde(default)]
    pub max_rate: Option<String>,
    #[serde(default)]
    pub buffer_size: Option<String>,
    #[serde(default)]
    pub x264_preset: Option<X264Preset>,
    #[serde(default)]
    pub gop: Option<u32>,
    #[serde(default)]
    pub prores_profile: Option<ProresProfile>,

    // colour / frames
    #[serde(default)]
    pub pixel_format: Option<PixelFormat>,
    #[serde(default)]
    pub color_space: Option<ColorSpace>,
    #[serde(default)]
    pub image_format: Option<ImageFormat>,
    #[serde(default)]
    pub jpeg_quality: Option<u32>,
    /// Write numbered images instead of a video file (the output is a folder).
    #[serde(default)]
    pub image_sequence: bool,

    // audio
    #[serde(default)]
    pub audio_codec: Option<AudioCodec>,
    #[serde(default)]
    pub audio_bitrate: Option<String>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub enforce_audio_track: bool,

    // gif
    /// `None` = Remotion default (loop forever).
    #[serde(default)]
    pub gif_loops: Option<u32>,

    // performance
    #[serde(default)]
    pub concurrency: Option<u32>,
    #[serde(default)]
    pub hardware_acceleration: Option<HardwareAcceleration>,

    /// JSON passed as `--props` (overrides the composition's default props for this render only).
    #[serde(default)]
    pub props_json: Option<String>,
}

fn one() -> f64 {
    1.0
}

impl RenderSettings {
    pub fn new(codec: Codec) -> Self {
        RenderSettings {
            codec,
            scale: 1.0,
            width: None,
            height: None,
            fps: None,
            frames: None,
            every_nth_frame: None,
            crf: None,
            video_bitrate: None,
            max_rate: None,
            buffer_size: None,
            x264_preset: None,
            gop: None,
            prores_profile: None,
            pixel_format: None,
            color_space: None,
            image_format: None,
            jpeg_quality: None,
            image_sequence: false,
            audio_codec: None,
            audio_bitrate: None,
            sample_rate: None,
            muted: false,
            enforce_audio_track: false,
            gif_loops: None,
            concurrency: None,
            hardware_acceleration: None,
            props_json: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsError {
    /// the field the message is about
    pub field: &'static str,
    pub message: String,
}

fn err(field: &'static str, message: impl Into<String>) -> SettingsError {
    SettingsError { field, message: message.into() }
}

fn push(a: &mut Vec<String>, name: &str, value: String) {
    a.push(name.to_string());
    a.push(value);
}

/// "8M", "2500k", "800000": digits with an optional k/K/M/m suffix.
pub fn valid_bitrate(s: &str) -> bool {
    let t = s.trim();
    let digits = t.trim_end_matches(['k', 'K', 'm', 'M']);
    !digits.is_empty() && t.len() - digits.len() <= 1 && digits.parse::<f64>().map_or(false, |v| v > 0.0)
}

impl RenderSettings {
    /// Reject combinations Remotion/FFmpeg would refuse, with a message a person can act on.
    pub fn validate(&self, still: bool) -> Result<(), SettingsError> {
        if !(self.scale > 0.0 && self.scale <= 8.0) {
            return Err(err("scale", "Resolution scale must be between 0 and 8."));
        }
        if let Some((a, b)) = self.frames {
            if a > b {
                return Err(err("frames", "The first frame must not come after the last frame."));
            }
        }
        for (field, v) in [("width", self.width), ("height", self.height)] {
            if v.is_some_and(|n| n == 0 || n > 16384) {
                return Err(err(field, "Size must be between 1 and 16384 pixels."));
            }
        }
        if self.fps.is_some_and(|f| !(f > 0.0 && f <= 240.0)) {
            return Err(err("fps", "Frame rate must be between 0 and 240."));
        }
        if self.every_nth_frame.is_some_and(|n| n == 0) {
            return Err(err("every_nth_frame", "Every-nth-frame must be at least 1."));
        }
        if self.concurrency.is_some_and(|n| n == 0 || n > 128) {
            return Err(err("concurrency", "Concurrency must be between 1 and 128."));
        }
        if let Some(q) = self.jpeg_quality {
            if q > 100 {
                return Err(err("jpeg_quality", "JPEG quality must be between 0 and 100."));
            }
        }
        for (field, v) in [("video_bitrate", &self.video_bitrate), ("max_rate", &self.max_rate), ("buffer_size", &self.buffer_size), ("audio_bitrate", &self.audio_bitrate)] {
            if v.as_deref().is_some_and(|s| !valid_bitrate(s)) {
                return Err(err(field, "Use a number with an optional k or M suffix, for example 8M or 2500k."));
            }
        }
        if let Some(p) = &self.props_json {
            if serde_json::from_str::<serde_json::Value>(p).is_err() {
                return Err(err("props_json", "Props must be valid JSON."));
            }
        }
        if still {
            return Ok(()); // stills only use the image options below, which are validated above
        }

        let c = self.codec;
        if self.image_sequence {
            if c.is_audio_only() {
                return Err(err("image_sequence", "An image sequence has no audio codec: choose a video codec or turn the sequence off."));
            }
            return Ok(());
        }
        if self.crf.is_some() && self.video_bitrate.is_some() {
            return Err(err("crf", "Choose either a quality (CRF) or a bitrate, not both."));
        }
        if let Some(crf) = self.crf {
            match c.crf_range() {
                None => return Err(err("crf", format!("{} does not use CRF.", c.as_arg()))),
                Some((lo, hi)) if crf < lo || crf > hi => return Err(err("crf", format!("CRF for {} must be between {lo} and {hi}.", c.as_arg()))),
                _ => {}
            }
        }
        if self.video_bitrate.is_some() && c.crf_range().is_none() {
            return Err(err("video_bitrate", format!("{} does not use a bitrate.", c.as_arg())));
        }
        if self.x264_preset.is_some() && !c.is_h264() {
            return Err(err("x264_preset", "The x264 preset only applies to H.264."));
        }
        if self.prores_profile.is_some() && c != Codec::Prores {
            return Err(err("prores_profile", "The ProRes profile only applies to ProRes."));
        }
        if self.gop.is_some() && !(c.is_h264() || c == Codec::H265) {
            return Err(err("gop", "GOP size only applies to H.264 and H.265."));
        }
        if self.gif_loops.is_some() && c != Codec::Gif {
            return Err(err("gif_loops", "Loop count only applies to GIF."));
        }
        if let Some(pf) = self.pixel_format {
            if c.is_audio_only() || c == Codec::Gif {
                return Err(err("pixel_format", format!("{} has no pixel format.", c.as_arg())));
            }
            if pf.has_alpha() && !matches!(c, Codec::Prores | Codec::Vp8 | Codec::Vp9) {
                return Err(err("pixel_format", "Transparency needs ProRes 4444, VP8 or VP9."));
            }
            if pf.is_10bit() && !matches!(c, Codec::Prores | Codec::H265 | Codec::H264 | Codec::H264Mkv | Codec::H264Ts | Codec::Vp9) {
                return Err(err("pixel_format", "10-bit needs ProRes, H.265, H.264 or VP9."));
            }
            if c == Codec::Prores && !matches!(pf, PixelFormat::Yuv422p10le | PixelFormat::Yuv444p10le | PixelFormat::Yuva444p10le) {
                return Err(err("pixel_format", "ProRes uses a 10-bit 4:2:2 or 4:4:4 pixel format."));
            }
            if pf.has_alpha() && self.image_format == Some(ImageFormat::Jpeg) {
                return Err(err("image_format", "JPEG frames have no transparency: use PNG."));
            }
        }
        if self.audio_codec.is_some() && (c.is_audio_only() || c == Codec::Gif) {
            return Err(err("audio_codec", format!("{} does not take an audio codec.", c.as_arg())));
        }
        if (self.audio_bitrate.is_some() || self.sample_rate.is_some()) && c == Codec::Gif {
            return Err(err("audio_bitrate", "GIF has no audio."));
        }
        if c.is_audio_only() && (self.muted || self.pixel_format.is_some()) {
            return Err(err("muted", "An audio-only render cannot be muted."));
        }
        Ok(())
    }

    /// Arguments after `render <entry> <composition> <output>`; ordering is stable so command lines can be compared.
    pub fn to_args(&self, still: bool) -> Vec<String> {
        let mut a: Vec<String> = vec![];
        if !still {
            if self.image_sequence {
                // handled below as a bare flag
            } else {
                push(&mut a, "--codec", self.codec.as_arg().into());
            }
        }
        if (self.scale - 1.0).abs() > f64::EPSILON {
            a.push(format!("--scale={}", self.scale));
        }
        if let Some(w) = self.width {
            push(&mut a, "--width", w.to_string());
        }
        if let Some(h) = self.height {
            push(&mut a, "--height", h.to_string());
        }
        if let Some(f) = self.fps {
            push(&mut a, "--fps", format!("{f}"));
        }
        if !still {
            if let Some((s, e)) = self.frames {
                a.push(format!("--frames={s}-{e}"));
            }
            if let Some(n) = self.every_nth_frame.filter(|n| *n > 1) {
                push(&mut a, "--every-nth-frame", n.to_string());
            }
        }
        if let Some(v) = self.crf.filter(|_| !self.image_sequence) {
            push(&mut a, "--crf", v.to_string());
        }
        if !self.image_sequence {
            if let Some(v) = &self.video_bitrate {
                push(&mut a, "--video-bitrate", v.trim().into());
            }
            if let Some(v) = &self.max_rate {
                push(&mut a, "--max-rate", v.trim().into());
            }
            if let Some(v) = &self.buffer_size {
                push(&mut a, "--buffer-size", v.trim().into());
            }
            if let Some(v) = self.x264_preset {
                push(&mut a, "--x264-preset", v.as_arg().into());
            }
            if let Some(v) = self.gop {
                push(&mut a, "--gop", v.to_string());
            }
            if let Some(v) = self.prores_profile {
                push(&mut a, "--prores-profile", v.as_arg().into());
            }
            if let Some(v) = self.pixel_format {
                push(&mut a, "--pixel-format", v.as_arg().into());
            }
            if let Some(v) = self.audio_codec {
                push(&mut a, "--audio-codec", v.as_arg().into());
            }
            if let Some(v) = &self.audio_bitrate {
                push(&mut a, "--audio-bitrate", v.trim().into());
            }
            if let Some(v) = self.sample_rate {
                push(&mut a, "--sample-rate", v.to_string());
            }
            if self.muted {
                a.push("--muted".into());
            }
            if self.enforce_audio_track {
                a.push("--enforce-audio-track".into());
            }
            if let Some(v) = self.gif_loops {
                push(&mut a, "--number-of-gif-loops", v.to_string());
            }
        } else {
            a.push("--sequence".into());
        }
        if let Some(v) = self.color_space {
            push(&mut a, "--color-space", v.as_arg().into());
        }
        if let Some(v) = self.image_format {
            push(&mut a, "--image-format", v.as_arg().into());
        }
        if let Some(v) = self.jpeg_quality {
            push(&mut a, "--jpeg-quality", v.to_string());
        }
        if let Some(v) = self.concurrency {
            push(&mut a, "--concurrency", v.to_string());
        }
        if let Some(v) = self.hardware_acceleration {
            push(&mut a, "--hardware-acceleration", v.as_arg().into());
        }
        if let Some(p) = &self.props_json {
            push(&mut a, "--props", p.clone());
        }
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(codec: Codec) -> RenderSettings {
        RenderSettings::new(codec)
    }

    #[test]
    fn defaults_produce_a_minimal_command() {
        assert_eq!(s(Codec::H264).to_args(false), ["--codec", "h264"]);
        assert!(s(Codec::H264).to_args(true).is_empty());
    }

    #[test]
    fn full_h264_settings_become_flags() {
        let mut r = s(Codec::H264);
        r.crf = Some(18);
        r.x264_preset = Some(X264Preset::Slow);
        r.pixel_format = Some(PixelFormat::Yuv420p);
        r.color_space = Some(ColorSpace::Bt709);
        r.audio_codec = Some(AudioCodec::Aac);
        r.audio_bitrate = Some("192k".into());
        r.width = Some(1280);
        r.height = Some(720);
        r.fps = Some(24.0);
        r.concurrency = Some(4);
        r.validate(false).unwrap();
        let args = r.to_args(false).join(" ");
        assert_eq!(
            args,
            "--codec h264 --width 1280 --height 720 --fps 24 --crf 18 --x264-preset slow --pixel-format yuv420p --audio-codec aac --audio-bitrate 192k --color-space bt709 --concurrency 4"
        );
    }

    #[test]
    fn crf_ranges_are_per_codec() {
        let mut r = s(Codec::H264);
        r.crf = Some(0);
        assert_eq!(r.validate(false).unwrap_err().field, "crf");
        r.crf = Some(51);
        assert!(r.validate(false).is_ok());
        let mut v = s(Codec::Vp9);
        v.crf = Some(63);
        assert!(v.validate(false).is_ok());
        v.crf = Some(64);
        assert!(v.validate(false).is_err());
        let mut p = s(Codec::Prores);
        p.crf = Some(10);
        assert!(p.validate(false).unwrap_err().message.contains("does not use CRF"));
    }

    #[test]
    fn crf_and_bitrate_are_exclusive_and_bitrates_are_checked() {
        let mut r = s(Codec::H264);
        r.crf = Some(20);
        r.video_bitrate = Some("8M".into());
        assert_eq!(r.validate(false).unwrap_err().field, "crf");
        r.crf = None;
        assert!(r.validate(false).is_ok());
        for bad in ["", "M", "8MB", "-5k", "abc", "8 M"] {
            r.video_bitrate = Some(bad.into());
            assert_eq!(r.validate(false).unwrap_err().field, "video_bitrate", "{bad:?}");
        }
        for ok in ["8M", "2500k", "800000", "1.5M"] {
            assert!(valid_bitrate(ok), "{ok}");
        }
    }

    #[test]
    fn codec_specific_options_are_refused_elsewhere() {
        let mut r = s(Codec::Vp9);
        r.x264_preset = Some(X264Preset::Fast);
        assert_eq!(r.validate(false).unwrap_err().field, "x264_preset");
        let mut r = s(Codec::H264);
        r.prores_profile = Some(ProresProfile::Hq);
        assert_eq!(r.validate(false).unwrap_err().field, "prores_profile");
        let mut r = s(Codec::H264);
        r.gif_loops = Some(3);
        assert_eq!(r.validate(false).unwrap_err().field, "gif_loops");
        let mut r = s(Codec::Gif);
        r.audio_codec = Some(AudioCodec::Aac);
        assert_eq!(r.validate(false).unwrap_err().field, "audio_codec");
    }

    #[test]
    fn pixel_formats_must_suit_the_codec() {
        let mut r = s(Codec::H264);
        r.pixel_format = Some(PixelFormat::Yuva420p);
        assert!(r.validate(false).unwrap_err().message.contains("Transparency"));
        let mut r = s(Codec::Prores);
        r.pixel_format = Some(PixelFormat::Yuv420p);
        assert!(r.validate(false).unwrap_err().message.contains("ProRes"));
        r.pixel_format = Some(PixelFormat::Yuva444p10le);
        r.prores_profile = Some(ProresProfile::P4444);
        assert!(r.validate(false).is_ok());
        let mut r = s(Codec::Vp9);
        r.pixel_format = Some(PixelFormat::Yuva420p);
        r.image_format = Some(ImageFormat::Jpeg);
        assert_eq!(r.validate(false).unwrap_err().field, "image_format");
        r.image_format = Some(ImageFormat::Png);
        assert!(r.validate(false).is_ok());
    }

    #[test]
    fn audio_only_codecs_reject_video_options() {
        let mut r = s(Codec::Wav);
        assert!(r.validate(false).is_ok());
        r.pixel_format = Some(PixelFormat::Yuv420p);
        assert!(r.validate(false).is_err());
        let mut r = s(Codec::Mp3);
        r.audio_codec = Some(AudioCodec::Aac);
        assert_eq!(r.validate(false).unwrap_err().field, "audio_codec");
    }

    #[test]
    fn image_sequences_drop_encoding_flags() {
        let mut r = s(Codec::H264);
        r.image_sequence = true;
        r.image_format = Some(ImageFormat::Png);
        r.crf = Some(18);
        r.validate(false).unwrap();
        let args = r.to_args(false).join(" ");
        assert_eq!(args, "--sequence --image-format png");
        assert!(!args.contains("--codec") && !args.contains("--crf"));
    }

    #[test]
    fn stills_only_get_image_options() {
        let mut r = s(Codec::H264);
        r.image_format = Some(ImageFormat::Jpeg);
        r.jpeg_quality = Some(90);
        r.frames = Some((0, 10));
        r.scale = 2.0;
        assert_eq!(r.to_args(true).join(" "), "--scale=2 --image-format jpeg --jpeg-quality 90");
    }

    #[test]
    fn numeric_bounds_are_enforced() {
        for mutate in [
            |r: &mut RenderSettings| r.scale = 0.0,
            |r: &mut RenderSettings| r.scale = 9.0,
            |r: &mut RenderSettings| r.frames = Some((9, 2)),
            |r: &mut RenderSettings| r.width = Some(0),
            |r: &mut RenderSettings| r.fps = Some(0.0),
            |r: &mut RenderSettings| r.fps = Some(1000.0),
            |r: &mut RenderSettings| r.concurrency = Some(0),
            |r: &mut RenderSettings| r.jpeg_quality = Some(101),
            |r: &mut RenderSettings| r.every_nth_frame = Some(0),
            |r: &mut RenderSettings| r.props_json = Some("{not json".into()),
        ] {
            let mut r = s(Codec::H264);
            mutate(&mut r);
            assert!(r.validate(false).is_err());
        }
    }

    #[test]
    fn props_are_passed_as_a_single_argument() {
        let mut r = s(Codec::H264);
        r.props_json = Some(r#"{"title":"a b; rm -rf /"}"#.into());
        let a = r.to_args(false);
        assert_eq!(a.last().unwrap(), r#"{"title":"a b; rm -rf /"}"#);
        assert_eq!(a[a.len() - 2], "--props");
    }

    #[test]
    fn settings_round_trip_through_json_with_cli_names() {
        let mut r = s(Codec::H265);
        r.color_space = Some(ColorSpace::Bt2020Ncl);
        let j = serde_json::to_value(&r).unwrap();
        assert_eq!(j["codec"], "h265");
        assert_eq!(j["color_space"], "bt2020-ncl");
        let back: RenderSettings = serde_json::from_value(j).unwrap();
        assert_eq!(back, r);
        // a minimal payload from the UI only needs the codec
        let min: RenderSettings = serde_json::from_value(serde_json::json!({"codec":"prores"})).unwrap();
        assert_eq!(min.scale, 1.0);
    }
}
