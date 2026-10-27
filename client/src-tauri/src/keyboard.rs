#[cfg(target_os = "linux")]
fn hardware_keyboard() -> Result<bool, String> {
    let devices = std::fs::read_dir("/sys/class/input")
        .map_err(|_| "Cannot inspect keyboard devices".to_string())?;
    for device in devices {
        let device = device.map_err(|_| "Cannot inspect keyboard device".to_string())?;
        if !device.file_name().to_string_lossy().starts_with("event") {
            continue;
        }
        let path = device.path().join("device");
        let resolved = path
            .canonicalize()
            .map_err(|_| "Cannot resolve keyboard device".to_string())?;
        if resolved
            .components()
            .any(|part| part.as_os_str() == "virtual")
        {
            continue;
        }
        let bus = std::fs::read_to_string(path.join("id/bustype"))
            .map_err(|_| "Cannot inspect keyboard bus".to_string())?;
        if !matches!(bus.trim(), "0003" | "0005") {
            continue;
        }
        let keys = std::fs::read_to_string(path.join("capabilities/key"))
            .map_err(|_| "Cannot inspect keyboard capabilities".to_string())?;
        let Some(word) = keys.split_whitespace().next_back() else {
            continue;
        };
        let bits = u64::from_str_radix(word, 16)
            .map_err(|_| "Invalid keyboard capabilities".to_string())?;
        if [28, 30, 44, 57]
            .iter()
            .all(|key| bits & (1_u64 << key) != 0)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub(crate) async fn hardware_keyboard_available() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(hardware_keyboard)
            .await
            .map_err(|_| "Keyboard detection interrupted".to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    Ok(true)
}
