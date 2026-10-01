//! New-project templates. Every template is a plain Remotion project (no ReFlow-specific format);
//! components export `motionMetadata` so the inspector works immediately.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

pub fn list() -> Vec<Template> {
    vec![
        Template { id: "title", name: "Title card", description: "One 1080p composition with an animated title, a delayed subtitle and editable properties." },
        Template { id: "social", name: "Social set", description: "Square, story and landscape compositions sharing one editable card component." },
    ]
}

#[derive(Debug, PartialEq)]
pub enum TemplateError {
    UnknownTemplate,
    InvalidName,
    AlreadyExists(String),
    Io(String),
}

/// Project folder names: lowercase letters, digits, `-` and `_`, starting with a letter or digit.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

const PACKAGE_JSON: &str = r##"{
  "name": "{{name}}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "remotion studio src/index.ts",
    "render": "remotion render src/index.ts"
  },
  "dependencies": {
    "@remotion/cli": "{{remotion}}",
    "@remotion/player": "{{remotion}}",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "remotion": "{{remotion}}"
  },
  "devDependencies": {
    "@types/react": "19.3.0",
    "typescript": "5.9.3"
  }
}
"##;

const TSCONFIG: &str = r##"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "remotion.config.ts"]
}
"##;

const REMOTION_CONFIG: &str = "import { Config } from \"@remotion/cli/config\";\n\nConfig.setVideoImageFormat(\"jpeg\");\n";
const INDEX_TS: &str = "import { registerRoot } from \"remotion\";\nimport { Root } from \"./Root\";\n\nregisterRoot(Root);\n";
const GITIGNORE: &str = "node_modules\nout\n.reflow\n";

const README: &str = "# {{name}}\n\nA Remotion project created with ReFlow Motion.\n\n```bash\nnpm install\nnpm run dev      # Remotion Studio\n```\n\nOpen this folder in ReFlow Motion to preview, edit properties visually and render.\n";

const TITLE_ROOT: &str = r##"import { Composition } from "remotion";
import { Title } from "./Title";

const FPS = 30;

export const Root = () => (
  <>
    <Composition
      id="Title"
      component={Title}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={150}
      defaultProps={{ title: "Hello, motion", subtitle: "made with ReFlow", color: "#ffffff", background: "#111111", opacity: 1, offset: { x: 0, y: 0 } }}
    />
  </>
);
"##;

const TITLE_COMPONENT: &str = r##"import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";

export interface TitleProps {
  title: string;
  subtitle: string;
  color: string;
  background: string;
  opacity: number;
  offset: { x: number; y: number };
}

/** Props the ReFlow inspector may edit. Plain data: no ReFlow import needed. */
export const motionMetadata = {
  editable: {
    title: { type: "string", label: "Title", group: "Content" },
    subtitle: { type: "string", label: "Subtitle", group: "Content" },
    color: { type: "color", label: "Text color", group: "Style" },
    background: { type: "color", label: "Background", group: "Style" },
    opacity: { type: "number", min: 0, max: 1, step: 0.01, group: "Style" },
    offset: { type: "vector2", label: "Offset", group: "Transform" },
  },
};

export const Title = ({ title, subtitle, color, background, opacity, offset }: TitleProps) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 24, 120, 150], [0, 1, 1, 0]);
  const rise = interpolate(frame, [0, 24], [40, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: background, justifyContent: "center", alignItems: "center" }}>
      <h1
        style={{
          color,
          fontFamily: "system-ui, sans-serif",
          fontSize: 140,
          margin: 0,
          opacity: fade * opacity,
          transform: `translate(${offset.x}px, ${offset.y + rise}px)`,
        }}
      >
        {title}
      </h1>
      <Sequence from={30} durationInFrames={100} name="Subtitle">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 160 }}>
          <p style={{ color, opacity: 0.7, fontFamily: "system-ui, sans-serif", fontSize: 48 }}>{subtitle}</p>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
"##;

const SOCIAL_ROOT: &str = r##"import { Composition } from "remotion";
import { Card } from "./Card";

const FPS = 30;
const props = { headline: "New episode", accent: "#ff5a3c", background: "#16171a", opacity: 1 };

export const Root = () => (
  <>
    <Composition id="Square" component={Card} width={1080} height={1080} fps={FPS} durationInFrames={120} defaultProps={{ headline: "New episode", accent: "#ff5a3c", background: "#16171a", opacity: 1 }} />
    <Composition id="Story" component={Card} width={1080} height={1920} fps={FPS} durationInFrames={120} defaultProps={{ headline: "New episode", accent: "#3c9bff", background: "#101820", opacity: 1 }} />
    <Composition id="Landscape" component={Card} width={1920} height={1080} fps={FPS} durationInFrames={120} defaultProps={{ headline: "New episode", accent: "#4cc38a", background: "#11181a", opacity: 1 }} />
  </>
);

export { props };
"##;

const SOCIAL_COMPONENT: &str = r##"import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export interface CardProps {
  headline: string;
  accent: string;
  background: string;
  opacity: number;
}

export const motionMetadata = {
  editable: {
    headline: { type: "string", label: "Headline", group: "Content" },
    accent: { type: "color", label: "Accent", group: "Style" },
    background: { type: "color", label: "Background", group: "Style" },
    opacity: { type: "number", min: 0, max: 1, step: 0.01, group: "Style" },
  },
};

export const Card = ({ headline, accent, background, opacity }: CardProps) => {
  const frame = useCurrentFrame();
  const bar = interpolate(frame, [0, 30], [0, 100], { extrapolateRight: "clamp" });
  const text = interpolate(frame, [10, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: background, justifyContent: "center", padding: 80 }}>
      <div style={{ height: 12, width: `${bar}%`, backgroundColor: accent, marginBottom: 40 }} />
      <h1 style={{ color: "white", fontFamily: "system-ui, sans-serif", fontSize: 120, margin: 0, opacity: text * opacity }}>{headline}</h1>
    </AbsoluteFill>
  );
};
"##;

/// Files of a template, with placeholders substituted. Paths are project-relative.
pub fn files(template: &str, name: &str, remotion_version: &str) -> Option<Vec<(String, String)>> {
    let (root, component_path, component) = match template {
        "title" => (TITLE_ROOT, "src/Title.tsx", TITLE_COMPONENT),
        "social" => (SOCIAL_ROOT, "src/Card.tsx", SOCIAL_COMPONENT),
        _ => return None,
    };
    let sub = |s: &str| s.replace("{{name}}", name).replace("{{remotion}}", remotion_version);
    Some(vec![
        ("package.json".into(), sub(PACKAGE_JSON)),
        ("tsconfig.json".into(), TSCONFIG.into()),
        ("remotion.config.ts".into(), REMOTION_CONFIG.into()),
        (".gitignore".into(), GITIGNORE.into()),
        ("README.md".into(), sub(README)),
        ("src/index.ts".into(), INDEX_TS.into()),
        ("src/Root.tsx".into(), root.into()),
        (component_path.into(), component.into()),
        ("public/.gitkeep".into(), String::new()),
    ])
}

/// Create `<parent>/<name>` from a template. Refuses to touch an existing path.
pub fn create(template: &str, parent: &Path, name: &str, remotion_version: &str) -> Result<PathBuf, TemplateError> {
    if !valid_name(name) {
        return Err(TemplateError::InvalidName);
    }
    let files = files(template, name, remotion_version).ok_or(TemplateError::UnknownTemplate)?;
    let dest = parent.join(name);
    if dest.exists() {
        return Err(TemplateError::AlreadyExists(dest.display().to_string()));
    }
    for (rel, content) in files {
        let path = dest.join(&rel);
        std::fs::create_dir_all(path.parent().expect("file has a parent")).map_err(|e| TemplateError::Io(e.to_string()))?;
        std::fs::write(path, content).map_err(|e| TemplateError::Io(e.to_string()))?;
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect_project;

    #[test]
    fn names_are_folder_safe() {
        for ok in ["my-video", "a", "intro_2", "2024-reel"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", "My Video", "../x", "-x", "a/b", "A", "x".repeat(65).as_str(), "naïve"] {
            assert!(!valid_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn every_template_is_a_valid_remotion_project_for_reflow() {
        for t in list() {
            let dir = tempfile::tempdir().unwrap();
            let path = create(t.id, dir.path(), "demo", "4.0.532").unwrap();
            let info = detect_project(&path).unwrap_or_else(|e| panic!("{}: {e}", t.id));
            assert_eq!(info.name.as_deref(), Some("demo"));
            assert_eq!(info.remotion_version, "4.0.532");
            assert_eq!(info.entry_point.as_deref(), Some("src/index.ts"));
            assert!(!info.compositions.is_empty());
            for c in &info.compositions {
                assert!(c.component_ref.is_some(), "{}: {} has no resolvable component", t.id, c.id);
                assert!(c.width.is_some() && c.height.is_some() && c.fps.is_some() && c.duration_in_frames.is_some(), "{}: {} not fully static", t.id, c.id);
                assert!(c.default_props.is_some(), "{}: {} defaultProps not literal", t.id, c.id);
                assert!(c.metadata.is_some(), "{}: {} has no motionMetadata", t.id, c.id);
                assert!(!c.animations.is_empty(), "{}: {} has no keyframes", t.id, c.id);
            }
        }
    }

    #[test]
    fn title_template_exposes_layers_and_keyframes() {
        let dir = tempfile::tempdir().unwrap();
        let info = detect_project(&create("title", dir.path(), "t", "4.0.532").unwrap()).unwrap();
        let c = &info.compositions[0];
        assert_eq!(c.layers.len(), 1);
        assert_eq!(c.animations.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["fade", "rise"]);
        assert_eq!(c.animations[0].frames, vec![0.0, 24.0, 120.0, 150.0]);
    }

    #[test]
    fn refuses_existing_unknown_and_invalid() {
        let dir = tempfile::tempdir().unwrap();
        create("title", dir.path(), "a", "4.0.532").unwrap();
        assert!(matches!(create("title", dir.path(), "a", "4.0.532"), Err(TemplateError::AlreadyExists(_))));
        assert_eq!(create("nope", dir.path(), "b", "4.0.532"), Err(TemplateError::UnknownTemplate));
        assert_eq!(create("title", dir.path(), "../evil", "4.0.532"), Err(TemplateError::InvalidName));
        assert!(!dir.path().join("b").exists());
    }

    #[test]
    fn placeholders_are_fully_substituted() {
        for (_, content) in files("social", "x", "4.0.1").unwrap() {
            assert!(!content.contains("{{name}}") && !content.contains("{{remotion}}"), "unsubstituted placeholder");
        }
    }
}
