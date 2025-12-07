(async function(){
  // --- 要素取得と安全チェック ---
  const nsecInput = document.getElementById('nsecInput');
  const npubDisplay = document.getElementById('npubDisplay');
  const hexDisplay = document.getElementById('hexDisplay');
  const dTagSelect = document.getElementById('dTagSelect');
  const contentInput = document.getElementById('contentInput');
  const pTagsInput = document.getElementById('pTagsInput');
  const generatedJsonPre = document.getElementById('generatedJson');
  const logDiv = document.getElementById('log');
  const decryptButton = document.getElementById('decryptButton');
  const newListFormContainer = document.getElementById('newListFormContainer');
  const generateButton = document.getElementById('generateButton');
  const updateButton = document.getElementById('updateButton');
  const loader = document.getElementById('loader');
  const getFromExtensionButton = document.getElementById('getFromExtensionButton');
  const newDTagInput = document.getElementById('newDTagInput');

  if (!npubDisplay || !hexDisplay || !nsecInput) {
    console.error('必須のDOM要素が見つかりません。スクリプトを正しい位置に配置してください。');
    return;
  }

  // --- nostr-tools shortcuts ---
  const { nip19, getPublicKey, finalizeEvent, nip04 } = window.NostrTools || {};

  // --- 設定 ---
  const relayUrls = ['wss://relay.nostr.band','wss://nos.lol'];
  let connectedRelayUrl = '';
  const eventMap = new Map();
  let currentEvent = null;
  let originalPubkeysFromPtag = [];
  let originalDtag = '';

  // --- UI helper ---
  function showLoader(){ if (loader) loader.style.display = 'block'; }
  function hideLoader(){ if (loader) loader.style.display = 'none'; }
  function log(message, type='info'){
    try{
      if (type==='error') console.error(message);
      else if (type==='success') console.log(message);
      else console.log(message);
      if(logDiv){
        const p = document.createElement('div');
        p.textContent = message;
        p.style.color = type==='error' ? 'crimson' : type==='success' ? 'green' : 'inherit';
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight;
      }
    }catch(e){}
  }

  function parsePubkeys(input){
    if(!input) return [];
    return input.split(/[\n, \t]+/).map(k=>k.trim()).filter(k=>k.length===64);
  }

  // --- get keys from nsec (nostr-tools nip19) ---
  function getKeysFromNsec(nsec){
    if(!nip19 || !getPublicKey) throw new Error('nostr-tools が未ロードです');
    const decoded = nip19.decode(nsec);
    if(decoded.type !== 'nsec') throw new Error('nsecではありません');
    const privkey = decoded.data;
    const pubkey = getPublicKey(privkey);
    return { privkey, pubkey };
  }

  // --- WebSocket connection helper ---
  function connectWebSocket(onOpen, onMessage, onError, onClose){
    let index = 0;
    let closed = false;
    function tryConnect(){
      if(closed) return;
      const url = relayUrls[index];
      let socket;
      try{
        socket = new WebSocket(url);
      }catch(e){
        index++;
        if(index < relayUrls.length) tryConnect();
        else onError && onError(e);
        return;
      }
      socket.onopen = () => {
        connectedRelayUrl = url;
        onOpen && onOpen(socket);
      };
      socket.onmessage = (ev) => onMessage && onMessage(ev);
      socket.onerror = (err) => {
        try{ socket.close(); }catch(e){}
        index++;
        if(index < relayUrls.length) tryConnect();
        else onError && onError(err);
      };
      socket.onclose = (ev) => {
        onClose && onClose(ev);
      };
    }
    tryConnect();
    return {
      close: ()=>{ closed = true; }
    };
  }

  // --- NIP-07 / extension friendly helpers ---
  async function signEventWithPreferExtension(event, privkey){
    try{
      if(window.nostr && typeof window.nostr.signEvent === 'function'){
        const res = await window.nostr.signEvent(event);
        if(res && res.id && res.sig && res.pubkey) return res;
        if(res && res.sig){
          return { ...event, id: event.id || '', sig: res.sig, pubkey: res.pubkey || event.pubkey || '' };
        }
      }
    }catch(e){
      console.warn('extension signEvent failed:', e);
    }
    return finalizeEvent(event, privkey);
  }

  async function encryptPreferExtension(theirPubkeyHex, plaintext, privkey){
    try{
      if(window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.encrypt === 'function'){
        try{
          return await window.nostr.nip04.encrypt(theirPubkeyHex, plaintext);
        }catch(e){
          try{
            return await window.nostr.nip04.encrypt(plaintext, theirPubkeyHex);
          }catch(e2){
            throw e;
          }
        }
      }
    }catch(e){
      console.warn('extension nip04.encrypt failed:', e);
    }
    return await nip04.encrypt(privkey, theirPubkeyHex, plaintext);
  }

  async function decryptPreferExtension(theirPubkeyHex, ciphertext, privkey){
    try{
      if(window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.decrypt === 'function'){
        try{
          return await window.nostr.nip04.decrypt(theirPubkeyHex, ciphertext);
        }catch(e){
          try{
            return await window.nostr.nip04.decrypt(ciphertext, theirPubkeyHex);
          }catch(e2){
            throw e;
          }
        }
      }
    }catch(e){
      console.warn('extension nip04.decrypt failed:', e);
    }
    return await nip04.decrypt(privkey, theirPubkeyHex, ciphertext);
  }

  // --- getFromExtension button handler ---
  if(getFromExtensionButton){
    getFromExtensionButton.addEventListener('click', async () => {
      try{
        if(!window.nostr || typeof window.nostr.getPublicKey !== 'function'){
          alert('NIP-07対応の拡張機能が見つかりません。拡張を有効化して再試行してください。');
          return;
        }
        const pubkeyHex = await window.nostr.getPublicKey();
        if(!pubkeyHex || typeof pubkeyHex !== 'string') throw new Error('公開鍵の取得に失敗しました');
        const npub = nip19 && nip19.npubEncode ? nip19.npubEncode(pubkeyHex) : pubkeyHex;
        npubDisplay.textContent = npub || '';
        hexDisplay.textContent = pubkeyHex || '';
        try{ nsecInput.value = ''; nsecInput.disabled = true; }catch(e){}
        log('拡張機能から公開鍵を取得しました。');
      }catch(e){
        log('拡張機能からの取得に失敗しました: ' + (e && e.message ? e.message : e), 'error');
      }
    });
  }

  // --- nsec input handler ---
  if(nsecInput){
    nsecInput.addEventListener('input', () => {
      const nsecValue = nsecInput.value.trim();
      if(!nsecValue){
        npubDisplay.textContent = '';
        hexDisplay.textContent = '';
        nsecInput.disabled = false;
        return;
      }
      try{
        if(nip19){
          const decoded = nip19.decode(nsecValue);
          if(decoded && decoded.type === 'nsec'){
            const seckey = decoded.data;
            const pubkey = getPublicKey(seckey);
            const npub = nip19.npubEncode(pubkey);
            npubDisplay.textContent = npub;
            hexDisplay.textContent = pubkey;
            nsecInput.disabled = false;
            return;
          }
        }
      }catch(e){}
      npubDisplay.textContent = '';
      hexDisplay.textContent = '';
    });
  }

  // --- fetchEvents ---
  async function fetchEvents(){
    showLoader();
    if(dTagSelect) dTagSelect.innerHTML = '<option value="">dタグを選択してください</option>';
    if(dTagSelect) dTagSelect.disabled = true;
    if(decryptButton) decryptButton.disabled = true;

    let pubkey;
    try{
      if(window.nostr && typeof window.nostr.getPublicKey === 'function'){
        pubkey = await window.nostr.getPublicKey();
      }else{
        const nsec = nsecInput.value.trim();
        if(!nsec){ log('nsecを入力してください。','error'); hideLoader(); return; }
        const keys = getKeysFromNsec(nsec);
        pubkey = keys.pubkey;
        if(pTagsInput) pTagsInput.value = pubkey;
      }
    }catch(e){
      log('公開鍵取得に失敗しました: ' + (e && e.message ? e.message : e), 'error');
      hideLoader();
      return;
    }

    const events = [];
    let currentSocket = null;
    connectWebSocket((socket)=>{
      log('WebSocket接続成功');
      currentSocket = socket;
      const subscriptionId = "kind30000_sub";
      const filter = { kinds: [30000], authors: [pubkey] };
      try{ socket.send(JSON.stringify(["REQ", subscriptionId, filter])); }
      catch(e){ log('REQ送信に失敗しました: ' + e.message, 'error'); }
    }, (ev)=>{
      try{
        const data = JSON.parse(ev.data);
        if(data[0] === "EVENT") events.push(data[2]);
        if(data[0] === "EOSE"){
          log('イベント取得完了。WebSocketを閉じます。');
          try{ currentSocket && currentSocket.close(); }catch(e){}
          if(events.length === 0){ log('kind:30000のイベントが見つかりませんでした。', 'error'); }
          else {
            eventMap.clear();
            events.forEach(e => {
              const dTag = e.tags.find(t => t[0] === 'd');
              if(dTag){
                eventMap.set(e.id, e);
                if(dTagSelect){
                  const option = document.createElement('option');
                  option.value = e.id;
                  option.textContent = dTag[1] || e.id;
                  dTagSelect.appendChild(option);
                }
              }
            });
            if(dTagSelect) dTagSelect.disabled = false;
            if(decryptButton) decryptButton.disabled = false;
            log(`${events.length}件のイベントを取得しました。`);
          }
          hideLoader();
        }
      }catch(err){
        console.warn('message parse error:', err);
      }
    }, ()=>{
      log('すべてのリレー接続に失敗しました。','error'); hideLoader();
    }, ()=>{
      log('WebSocket接続を閉じました。'); hideLoader();
    });
  }

  // --- decryptContent ---
  async function decryptContent(){
    showLoader();
    try{
      const selectedId = dTagSelect ? dTagSelect.value : '';
      if(!selectedId){ log('イベントを選択してください。','error'); hideLoader(); return; }
      currentEvent = eventMap.get(selectedId);
      if(!currentEvent){ log('イベント情報が見つかりません。','error'); hideLoader(); return; }

      let privkey = '';
      let userPubkey = '';
      try{
        if(window.nostr && typeof window.nostr.getPublicKey === 'function'){
          userPubkey = await window.nostr.getPublicKey();
        }else{
          const nsec = nsecInput.value.trim();
          if(!nsec){ log('拡張機能がない場合はnsecが必要です。','error'); hideLoader(); return; }
          const keys = getKeysFromNsec(nsec);
          privkey = keys.privkey;
          userPubkey = keys.pubkey;
        }
      }catch(e){
        log('自身の鍵取得に失敗しました: ' + (e && e.message ? e.message : e), 'error'); hideLoader(); return;
      }

      if(userPubkey !== currentEvent.pubkey){ log('入力された鍵は、このイベントの公開鍵と一致しません。','error'); hideLoader(); return; }

      originalPubkeysFromPtag = currentEvent.tags.filter(t => t[0] === 'p').map(t => t[1]);
      const dTagObj = currentEvent.tags.find(t => t[0] === 'd');
      originalDtag = dTagObj ? dTagObj[1] : '';
      if(originalPubkeysFromPtag.length === 0){ log('pタグが見つからないため復号できません。','error'); hideLoader(); return; }

      const pubkeyForDecryption = originalPubkeysFromPtag[0];
      const decryptedContent = await decryptPreferExtension(pubkeyForDecryption, currentEvent.content, privkey);
      const decryptedData = JSON.parse(decryptedContent);
      const pubkeys = decryptedData.map(tag => tag[1]);
      if(contentInput) contentInput.value = pubkeys.join('\n');
      if(pTagsInput) pTagsInput.value = originalPubkeysFromPtag.join('\n');
      log('イベントを正常に復号しました。');
      if(generateButton) generateButton.disabled = false;
    }catch(error){
      log('復号中にエラーが発生しました:' + (error && error.message ? error.message : error), 'error');
    }finally{
      hideLoader();
    }
  }

  // --- generateEvent ---
  async function generateEvent(){
    showLoader();
    try{
      let privkey = '';
      let pubkey = '';
      try{
        if(window.nostr && typeof window.nostr.getPublicKey === 'function'){
          pubkey = await window.nostr.getPublicKey();
        }else{
          const nsec = nsecInput.value.trim();
          if(!nsec){ log('拡張機能がない場合はnsecが必要です。','error'); hideLoader(); return; }
          const keys = getKeysFromNsec(nsec);
          privkey = keys.privkey;
          pubkey = keys.pubkey;
        }
      }catch(e){
        log('公開鍵の取得に失敗しました: ' + (e && e.message ? e.message : e), 'error'); hideLoader(); return;
      }

      const newContentPubkeys = parsePubkeys(contentInput ? contentInput.value : '');
      const newPTagsPubkeys = parsePubkeys(pTagsInput ? pTagsInput.value : '');
      if(newContentPubkeys.length === 0 || newPTagsPubkeys.length === 0){
        log('contentまたはpタグに含める公開鍵を入力してください。','error'); hideLoader(); return;
      }

      const dtagToUse = (newDTagInput && newDTagInput.value.trim()) || originalDtag;
      if(!dtagToUse){ log('dタグ(リスト名)を入力するか、既存イベントを選択してください。','error'); hideLoader(); return; }

      const contentTags = newContentPubkeys.map(k => ['p', k]);
      const recipientPubkeyForEncryption = newPTagsPubkeys[0];
      const encryptedContent = await encryptPreferExtension(recipientPubkeyForEncryption, JSON.stringify(contentTags), privkey);

      const event = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dtagToUse], ...newPTagsPubkeys.map(k => ['p', k])],
        content: encryptedContent,
      };

      const signedEvent = await signEventWithPreferExtension(event, privkey);
      if(generatedJsonPre) generatedJsonPre.textContent = JSON.stringify(signedEvent, null, 2);
      log('JSONイベントを生成しました。');
      if(updateButton) updateButton.disabled = false;
    }catch(error){
      log('JSON生成中にエラーが発生しました:' + (error && error.message ? error.message : error), 'error');
    }finally{
      hideLoader();
    }
  }

  // --- updateEvent ---
  async function updateEvent(){
    showLoader();
    try{
      if(!generatedJsonPre || !generatedJsonPre.textContent){ log('送信するイベントがありません。', 'error'); hideLoader(); return; }
      const event = JSON.parse(generatedJsonPre.textContent);
      const relayUrl = connectedRelayUrl || relayUrls[0];
      const socket = new WebSocket(relayUrl);
      socket.onopen = () => {
        log(`イベントを公開中のリレー:${relayUrl}`);
        log('イベント公開のためのWebSocket接続成功');
        try{ socket.send(JSON.stringify(["EVENT", event])); }
        catch(e){ log('EVENT送信に失敗しました: ' + e.message, 'error'); socket.close(); }
      };
      socket.onmessage = (msg) => {
        try{
          const data = JSON.parse(msg.data);
          if(data[0] === "OK"){
            if(data[2]){
              log('イベントは正常に公開されました！','success');
              alert(`${relayUrl} に kind:30000 を送信しました！`);
              if(contentInput) contentInput.value = '';
              if(pTagsInput) pTagsInput.value = '';
              if(newDTagInput) newDTagInput.value = '';
              if(dTagSelect) dTagSelect.selectedIndex = 0;
              if(decryptButton) decryptButton.disabled = true;
              if(dTagSelect) dTagSelect.disabled = true;
              if(updateButton) updateButton.disabled = true;
              if(generateButton) generateButton.disabled = true;
              if(generatedJsonPre) generatedJsonPre.textContent = '';
            } else {
              log('イベントの公開に失敗しました:' + (data[3] || 'unknown'), 'error');
            }
            socket.close();
          }
        }catch(e){
          console.warn('updateEvent message parse error', e);
        }
      };
      socket.onerror = (err) => {
        log('イベント公開時のWebSocketエラー:' + (err && err.message ? err.message : err), 'error');
        try{ socket.close(); }catch(e){}
        hideLoader();
      };
    }catch(error){
      log('イベント更新中にエラーが発生しました:' + (error && error.message ? error.message : error), 'error');
    }finally{
      hideLoader();
    }
  }

  // --- ボタンバインド ---
  const fetchButton = document.getElementById('fetchEventsButton');
  if(fetchButton) fetchButton.addEventListener('click', fetchEvents);
  if(decryptButton) decryptButton.addEventListener('click', decryptContent);
  const genBtn = document.getElementById('generateButton');
  if(genBtn) genBtn.addEventListener('click', generateEvent);
  const updBtn = document.getElementById('updateButton');
  if(updBtn) updBtn.addEventListener('click', updateEvent);

  window.myNostrList = { fetchEvents, decryptContent, generateEvent, updateEvent };

  // --- 初期表示: nsecに値があれば表示に反映 ---
  try{
    const nsecVal = nsecInput.value && nsecInput.value.trim();
    if(nsecVal){
      try{
        const decoded = nip19.decode(nsecVal);
        if(decoded && decoded.type === 'nsec'){
          const keys = getKeysFromNsec(nsecVal);
          npubDisplay.textContent = nip19.npubEncode(keys.pubkey);
          hexDisplay.textContent = keys.pubkey;
        }
      }catch(e){}
    }
  }catch(e){}

})(); // end IIFE