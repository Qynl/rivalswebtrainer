// Menus and native controls must keep Tab/Space/arrows. Do not enqueue gameplay
// keys from them, even if a network round continues while this client is paused.
export function acceptsGameplayKeys(g, event) {
  if (["lobby", "paused", "results"].includes(g.state) || g.selectingLoadout)
    return false;
  const target = event.target;
  if (target?.isContentEditable) return false;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target?.tagName))
    return false;
  if (
    target?.closest?.(
      'input,select,textarea,button,[contenteditable="true"],[role="textbox"]',
    )
  )
    return false;
  return true;
}
