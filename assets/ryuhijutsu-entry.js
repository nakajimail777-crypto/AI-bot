(function (root) {
  function read(search) {
    const params = new URLSearchParams(search);
    const valid = value => /^(?:[1-9]|11|22|33)$/.test(value || '');
    if (params.getAll('ryusei').length !== 1 || params.getAll('ryudo').length !== 1) return null;
    const ryusei = params.get('ryusei'), ryudo = params.get('ryudo');
    if (!valid(ryusei) || !valid(ryudo)) return null;
    return { ryusei: Number(ryusei), ryudo: Number(ryudo),
      message: '龍秘術の数字について聞きたいです。龍性' + ryusei + '・龍導' + ryudo + 'です。' };
  }
  root.DragonNumberEntry = { read };
})(globalThis);