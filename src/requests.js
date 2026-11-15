export async function requestJson(url) {
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      let timer;
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('数据请求失败'));
      };
      const request = GM_xmlhttpRequest({
        method: 'GET', url: url.href, anonymous: true, responseType: 'json',
        onload(response) {
          if (response.status < 200 || response.status >= 300) return fail();
          clearTimeout(timer);
          resolve(response.response);
        },
        onerror: fail,
        onabort: fail,
        ontimeout: fail,
      });
      timer = setTimeout(() => {
        reject(new Error('数据请求超时'));
        request?.abort();
      }, 12000);
    });
  }
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('数据请求失败');
  return response.json();
}
