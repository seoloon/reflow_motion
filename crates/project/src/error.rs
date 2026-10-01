use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("no package.json in {0}")]
    NoPackageJson(String),
    #[error("invalid package.json: {0}")]
    InvalidPackageJson(String),
    #[error("not a Remotion project: {0}")]
    NotRemotion(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// What the UI shows. `details` goes to the diagnostics log only.
#[derive(Debug, Clone, Serialize)]
pub struct UserMessage {
    pub title: String,
    pub hint: String,
    pub details: String,
}

impl ProjectError {
    pub fn user_message(&self) -> UserMessage {
        let (title, hint) = match self {
            ProjectError::NotADirectory(_) => (
                "That is not a folder.",
                "Choose the root folder of your Remotion project.",
            ),
            ProjectError::NoPackageJson(_) => (
                "No package.json found.",
                "Choose the folder that contains your project's package.json.",
            ),
            ProjectError::InvalidPackageJson(_) => (
                "The project's package.json could not be read.",
                "Check that it is valid JSON.",
            ),
            ProjectError::NotRemotion(_) => (
                "This does not look like a Remotion project.",
                "The package.json has no \"remotion\" dependency. Install it with your package manager.",
            ),
            ProjectError::Io(_) => (
                "A file could not be read.",
                "Check that the folder still exists and that you have permission to read it.",
            ),
        };
        UserMessage {
            title: title.into(),
            hint: hint.into(),
            details: self.to_string(),
        }
    }
}
