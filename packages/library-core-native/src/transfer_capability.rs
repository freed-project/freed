//! Product capability only: never grants authority or bypasses lifecycle proofs.
pub const LIBRARY_TRANSFER_ENABLED: bool = cfg!(feature = "library-transfer-acceptance");
pub const LIBRARY_TRANSFER_UNAVAILABLE: &str = "Primary transfer and consumer recovery are unavailable in this build pending installed convergence acceptance. Existing transfer fences remain active; use a compatible recovery build.";
pub fn require_library_transfer_capability() -> Result<(), String> {
    if LIBRARY_TRANSFER_ENABLED {
        Ok(())
    } else {
        Err(LIBRARY_TRANSFER_UNAVAILABLE.into())
    }
}
