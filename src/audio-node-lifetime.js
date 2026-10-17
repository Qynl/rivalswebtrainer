// One-shot buses are not retained after their source ends. Continuous voices
// and the shared noise buffer have their own explicit lifetime in GameAudio.
export function releaseEndedNodes(source, ...downstream) {
  let released = false;
  source.onended = () => {
    if (released) return;
    released = true;
    source.onended = null;
    for (const node of [source, ...downstream]) {
      try {
        node.disconnect();
      } catch {
        /* A closing AudioContext can detach first. */
      }
    }
  };
}
