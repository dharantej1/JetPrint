use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use bip39::{Language, Mnemonic};

/// Generates a 12-word BIP39 recovery phrase (128 bits of entropy).
pub fn generate_recovery_phrase() -> Result<String, String> {
    let mnemonic = Mnemonic::generate_in(Language::English, 12)
        .map_err(|e| format!("Failed to generate BIP39 mnemonic: {e}"))?;
    Ok(mnemonic.to_string())
}

/// Normalizes a 12-word BIP39 phrase for consistent hashing and verification.
pub fn normalize_phrase(phrase: &str) -> String {
    phrase
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Validates that a phrase is a valid 12-word English BIP39 mnemonic.
pub fn validate_phrase(phrase: &str) -> Result<String, String> {
    let normalized = normalize_phrase(phrase);
    let mnemonic = Mnemonic::parse_in(Language::English, &normalized)
        .map_err(|e| format!("Invalid recovery phrase: {e}"))?;
    if mnemonic.word_count() != 12 {
        return Err("Recovery phrase must be 12 words".to_string());
    }
    Ok(normalized)
}

/// Hashes a password or normalized recovery phrase with Argon2id.
pub fn hash_secret(secret: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Failed to hash secret: {e}"))
}

/// Verifies a plaintext secret against a stored Argon2 PHC hash.
pub fn verify_secret(secret: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(secret.as_bytes(), &parsed)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_12_word_bip39_phrase() {
        let phrase = generate_recovery_phrase().expect("should generate phrase");
        let words: Vec<&str> = phrase.split_whitespace().collect();
        assert_eq!(words.len(), 12);
        assert!(validate_phrase(&phrase).is_ok());
    }

    #[test]
    fn hashes_and_verifies_password_and_phrase() {
        let pw = "SuperSecret123!";
        let hash = hash_secret(pw).expect("should hash password");
        assert!(verify_secret(pw, &hash));
        assert!(!verify_secret("wrong-password", &hash));

        let phrase = generate_recovery_phrase().expect("phrase");
        let phrase_hash = hash_secret(&normalize_phrase(&phrase)).expect("hash phrase");
        let messy_input = format!("  {}  ", phrase.to_uppercase().replace(' ', "   "));
        let normalized = validate_phrase(&messy_input).expect("valid messy phrase");
        assert!(verify_secret(&normalized, &phrase_hash));
    }
}

