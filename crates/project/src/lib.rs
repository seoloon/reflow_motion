//! Remotion project detection and composition discovery.
//!
//! Pure analysis: nothing here executes project code.

mod compositions;
mod detect;
mod error;
pub mod animation;
pub mod assets;
pub mod literal;
pub mod templates;
pub mod patch;

pub use compositions::{resolve_component, scan_compositions, scan_layers, Layer, scan_source, ComponentRef, Composition};
pub use detect::{detect_project, Asset, AssetKind, PackageManager, ProjectInfo};
pub use error::{ProjectError, UserMessage};
