//! Installation-local onboarding intent. This record never grants authority.

use serde::{Deserialize, Serialize};

use crate::library_core_canonical::encode_canonical_value;

pub const DESKTOP_LIBRARY_SETUP_MAXIMUM_BYTES: usize = 1_024;
pub const DESKTOP_LIBRARY_SETUP_FILE: &str = "library-installation-setup-v1.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
pub enum DesktopLibrarySetupChoiceV1 {
    Primary,
    Follower {
        #[serde(rename = "libraryId")]
        library_id: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetupRecord {
    format: String,
    choice: DesktopLibrarySetupChoiceV1,
}

impl DesktopLibrarySetupChoiceV1 {
    pub fn validate(&self) -> Result<(), String> {
        if let Self::Follower { library_id } = self {
            if library_id.len() != 64
                || !library_id
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err("Desktop consumer Library identity is invalid".into());
            }
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let value = serde_json::to_value(SetupRecord {
            format: "freed_desktop_library_setup_v1".into(),
            choice: self.clone(),
        })
        .map_err(|_| "Desktop Library setup record is invalid".to_owned())?;
        encode_canonical_value(&value, DESKTOP_LIBRARY_SETUP_MAXIMUM_BYTES)
            .map_err(|_| "Desktop Library setup record exceeds its bound".to_owned())
    }

    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > DESKTOP_LIBRARY_SETUP_MAXIMUM_BYTES {
            return Err("Desktop Library setup record exceeds its bound".into());
        }
        let record: SetupRecord = serde_json::from_slice(bytes)
            .map_err(|_| "Desktop Library setup record has an invalid field set".to_owned())?;
        if record.format != "freed_desktop_library_setup_v1"
            || record.choice.canonical_bytes()? != bytes
        {
            return Err("Desktop Library setup record is not canonical".into());
        }
        Ok(record.choice)
    }
}
