// Offer a choice for explicit requests only. This never enables the mode.
(() => {
  function isRequested(text) {
    if (typeof text !== 'string' || text.includes('［少し強めに背中を押す］')) return false;
    const ownWords=text.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|`[^`]*`/g,'');
    if (/押さないで|押して(?:ほしくない|欲しくない|ほしくありません)|ほしい(?:わけ|訳)(?:ではない|じゃない)|後押し(?:は|を)?(?:不要|いらない)|背中を押す(?:とは|って何)|後押しを求めていない/.test(ownWords)) return false;
    return /(?:背中を|後押しを?)(?:少し|ちょっと|強めに|そっと)?(?:押して|して)(?:ほしい|欲しい|ほしいです|ください|くれる|もらいたい|もらえ|もらえる)|背中を押して[。！!？?\s]*$/.test(ownWords);
  }
  globalThis.DragonEncouragement = {isRequested};
})();
