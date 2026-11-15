//! Credential storage. Normal builds use Windows Credential Manager; the isolated E2E build uses memory.
//! They are never written to SQLite, configuration, logs, exports or frontend state.

use std::fmt;

#[cfg(test)]
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// A secret that cannot be printed by accident: `Debug` and `Display` are redacted.
#[derive(Clone)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
    /// The only way to read the value. Call sites are limited to building the Authorization header.
    pub fn expose(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}
impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

#[derive(Debug)]
pub enum SecretError {
    Unavailable(String),
}

pub trait SecretStore: Send + Sync {
    fn get(&self) -> Result<Option<Secret>, SecretError>;
    fn set(&self, secret: &Secret) -> Result<(), SecretError>;
    /// Deleting a credential that does not exist succeeds.
    fn delete(&self) -> Result<(), SecretError>;
}

#[cfg(any(not(feature = "notion-mock"), test))]
const ACCOUNT: &str = "notion-connection";

/// The credential service name for an application identity, e.g. `com.webswe.civildesk.dev.notion`.
/// Each identity (production, acceptance, e2e, dev) therefore uses a different Credential Manager entry.
#[cfg(any(not(feature = "notion-mock"), test))]
pub fn service_name(identifier: &str) -> String {
    format!("{identifier}.notion")
}

/// Windows Credential Manager (via the `keyring` crate's native backend).
#[cfg(any(not(feature = "notion-mock"), test))]
pub struct CredentialManagerStore {
    service: String,
}

#[cfg(any(not(feature = "notion-mock"), test))]
impl CredentialManagerStore {
    pub fn for_identity(identifier: &str) -> Self {
        Self {
            service: service_name(identifier),
        }
    }
    fn entry(&self) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(&self.service, ACCOUNT).map_err(|_| {
            SecretError::Unavailable("Windows Credential Manager is unavailable.".into())
        })
    }
}

#[cfg(any(not(feature = "notion-mock"), test))]
impl SecretStore for CredentialManagerStore {
    fn get(&self) -> Result<Option<Secret>, SecretError> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(Secret::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretError::Unavailable(
                "The saved Notion credential could not be read from Windows Credential Manager."
                    .into(),
            )),
        }
    }
    fn set(&self, secret: &Secret) -> Result<(), SecretError> {
        self.entry()?.set_password(secret.expose()).map_err(|_| {
            SecretError::Unavailable(
                "The Notion credential could not be saved to Windows Credential Manager.".into(),
            )
        })
    }
    fn delete(&self) -> Result<(), SecretError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretError::Unavailable(
                "The Notion credential could not be removed from Windows Credential Manager."
                    .into(),
            )),
        }
    }
}

/// The native E2E process keeps this store in the spec runner's memory across app restarts.
/// Compiled only with the test-only Notion feature; no environment selector or disk fallback exists.
#[cfg(feature = "notion-mock")]
pub struct E2eMemoryStore;

#[cfg(feature = "notion-mock")]
impl E2eMemoryStore {
    const URL: &'static str = "http://127.0.0.1:4456/credential";

    fn request(
        &self,
        method: reqwest::Method,
        value: Option<&str>,
    ) -> Result<Option<Secret>, SecretError> {
        use std::io::Read;
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|_| Self::unavailable())?;
        let mut request = client.request(method, Self::URL);
        if let Some(value) = value {
            request = request.body(value.to_owned());
        }
        let response = request.send().map_err(|_| Self::unavailable())?;
        match response.status().as_u16() {
            204 => Ok(None),
            200 => {
                let mut bytes = Vec::new();
                response
                    .take(4097)
                    .read_to_end(&mut bytes)
                    .map_err(|_| Self::unavailable())?;
                if bytes.len() > 4096 {
                    return Err(Self::unavailable());
                }
                let value = String::from_utf8(bytes).map_err(|_| Self::unavailable())?;
                Ok(Some(Secret::new(value)))
            }
            _ => Err(Self::unavailable()),
        }
    }

    fn unavailable() -> SecretError {
        SecretError::Unavailable("The E2E credential store is unavailable.".into())
    }
}

#[cfg(feature = "notion-mock")]
impl SecretStore for E2eMemoryStore {
    fn get(&self) -> Result<Option<Secret>, SecretError> {
        self.request(reqwest::Method::GET, None)
    }
    fn set(&self, secret: &Secret) -> Result<(), SecretError> {
        if secret.expose().len() > 4096 {
            return Err(Self::unavailable());
        }
        self.request(reqwest::Method::PUT, Some(secret.expose()))
            .map(|_| ())
    }
    fn delete(&self) -> Result<(), SecretError> {
        self.request(reqwest::Method::DELETE, None).map(|_| ())
    }
}

#[cfg(test)]
/// In-memory backing shared by several scoped stores, used by tests to model one credential vault.
#[derive(Clone, Default)]
pub struct MemoryVault(Arc<Mutex<HashMap<(String, String), String>>>);

#[cfg(test)]
pub struct MemorySecretStore {
    vault: MemoryVault,
    service: String,
}

#[cfg(test)]
impl MemorySecretStore {
    pub fn new(vault: &MemoryVault, identifier: &str) -> Self {
        Self {
            vault: vault.clone(),
            service: service_name(identifier),
        }
    }
}
#[cfg(test)]
impl MemoryVault {
    pub fn entries(&self) -> Vec<(String, String)> {
        self.0.lock().unwrap().keys().cloned().collect()
    }
}
#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn get(&self) -> Result<Option<Secret>, SecretError> {
        Ok(self
            .vault
            .0
            .lock()
            .unwrap()
            .get(&(self.service.clone(), ACCOUNT.into()))
            .map(|v| Secret::new(v.clone())))
    }
    fn set(&self, secret: &Secret) -> Result<(), SecretError> {
        self.vault.0.lock().unwrap().insert(
            (self.service.clone(), ACCOUNT.into()),
            secret.expose().to_string(),
        );
        Ok(())
    }
    fn delete(&self) -> Result<(), SecretError> {
        self.vault
            .0
            .lock()
            .unwrap()
            .remove(&(self.service.clone(), ACCOUNT.into()));
        Ok(())
    }
}

/// Replaces every occurrence of the token, and anything shaped like a Notion token, in text that may be shown or logged.
pub fn redact(text: &str, token: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(t) = token.filter(|t| t.len() >= 6) {
        out = out.replace(t, "[redacted]");
    }
    // Notion tokens start with `ntn_` (current) or `secret_` (legacy); mask the whole word.
    let mut result = String::with_capacity(out.len());
    for word in out.split_inclusive(|c: char| c.is_whitespace() || "\"'<>,;()[]{}".contains(c)) {
        let core =
            word.trim_end_matches(|c: char| c.is_whitespace() || "\"'<>,;()[]{}".contains(c));
        let tail = &word[core.len()..];
        if (core.starts_with("ntn_") || core.starts_with("secret_")) && core.len() > 8 {
            result.push_str("[redacted]");
            result.push_str(tail);
        } else {
            result.push_str(word);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_never_prints() {
        let s = Secret::new("ntn_supersecretvalue1234567890");
        assert!(!format!("{s:?}").contains("supersecret"));
        assert!(!format!("{s}").contains("supersecret"));
        assert!(!format!("{:?}", Some(&s)).contains("supersecret"));
    }

    #[test]
    fn service_names_are_identity_scoped_and_distinct() {
        let ids = [
            "com.webswe.civildesk",
            "com.webswe.civildesk.acceptance",
            "com.webswe.civildesk.e2e",
            "com.webswe.civildesk.dev",
        ];
        let names: std::collections::HashSet<_> = ids.iter().map(|i| service_name(i)).collect();
        assert_eq!(names.len(), 4);
        assert_eq!(
            service_name("com.webswe.civildesk.dev"),
            "com.webswe.civildesk.dev.notion"
        );
    }

    #[test]
    fn credentials_are_isolated_between_identities() {
        let vault = MemoryVault::default();
        let dev = MemorySecretStore::new(&vault, "com.webswe.civildesk.dev");
        let prod = MemorySecretStore::new(&vault, "com.webswe.civildesk");
        let e2e = MemorySecretStore::new(&vault, "com.webswe.civildesk.e2e");
        dev.set(&Secret::new("ntn_dev_token_000000")).unwrap();
        assert!(
            prod.get().unwrap().is_none(),
            "production must not see the development token"
        );
        assert!(e2e.get().unwrap().is_none());
        prod.set(&Secret::new("ntn_prod_token_00000")).unwrap();
        assert_eq!(dev.get().unwrap().unwrap().expose(), "ntn_dev_token_000000");
        prod.delete().unwrap();
        assert!(prod.get().unwrap().is_none());
        assert!(
            dev.get().unwrap().is_some(),
            "deleting one identity must not affect another"
        );
        assert_eq!(vault.entries().len(), 1);
    }

    #[test]
    fn redaction_masks_tokens_and_token_shaped_words() {
        let text =
            "failed with Bearer ntn_abcdefghijklmnop and secret_legacyvalue123 plus mytok123456";
        let out = redact(text, Some("mytok123456"));
        assert!(!out.contains("abcdefghijklmnop"));
        assert!(!out.contains("legacyvalue"));
        assert!(!out.contains("mytok123456"));
        assert!(out.contains("failed with Bearer"));
    }

    /// Real Windows Credential Manager round trip under a unique throwaway service name; removed afterwards.
    #[cfg(windows)]
    #[ignore = "manual OS credential-store test; excluded from offline verification"]
    #[test]
    fn windows_credential_manager_round_trip_and_isolation() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let a = CredentialManagerStore::for_identity(&format!(
            "com.webswe.civildesk.unittest-a-{stamp}"
        ));
        let b = CredentialManagerStore::for_identity(&format!(
            "com.webswe.civildesk.unittest-b-{stamp}"
        ));
        assert!(a.get().unwrap().is_none());
        a.set(&Secret::new("ntn_unit_test_value_1")).unwrap();
        assert_eq!(a.get().unwrap().unwrap().expose(), "ntn_unit_test_value_1");
        a.set(&Secret::new("ntn_unit_test_value_2")).unwrap();
        assert_eq!(
            a.get().unwrap().unwrap().expose(),
            "ntn_unit_test_value_2",
            "replacement"
        );
        assert!(
            b.get().unwrap().is_none(),
            "another identity must not read it"
        );
        a.delete().unwrap();
        assert!(a.get().unwrap().is_none());
        a.delete().unwrap();
    }
}
