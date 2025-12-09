/**
 * Nostr kind:30000 List Manager (改修版)
 * auth.js/auth-ui.jsと連携し、鍵管理を共通化
 */
class NostrListManager {
  constructor() {
    // DOM要素
    this.elements = {
      relayInput: document.getElementById('relayInput'),
      dTagSelect: document.getElementById('dTagSelect'),
      contentInput: document.getElementById('contentInput'),
      pTagsInput: document.getElementById('pTagsInput'),
      generatedJsonPre: document.getElementById('generatedJson'),
      logDiv: document.getElementById('log'),
      loader: document.getElementById('loader'),
      newListFormContainer: document.getElementById('newListFormContainer'),
      newDTagInput: document.getElementById('newDTagInput'),
      fetchEventsButton: document.getElementById('fetchEventsButton'),
      showNewListButton: document.getElementById('showNewListButton'),
      decryptButton: document.getElementById('decryptButton'),
      generateButton: document.getElementById('generateButton'),
      updateButton: document.getElementById('updateButton'),
      authStatusText: document.getElementById('auth-status-text'),
      authStatus: document.getElementById('auth-status'),
      logoutButton: document.getElementById('logout-button'),
      decryptAuthPanel: document.getElementById('decrypt-auth-panel'),
      decryptWithExtension: document.getElementById('decrypt-with-extension'),
      decryptNsecInput: document.getElementById('decrypt-nsec-input'),
      decryptWithNsec: document.getElementById('decrypt-with-nsec'),
      cancelDecrypt: document.getElementById('cancel-decrypt')
    };

    // 状態管理
    this.state = {
      eventMap: new Map(),
      currentEvent: null,
      originalDtag: '',
      lastConnectedRelay: '',
      decryptKey: null // 復号用の一時的な鍵
    };

    // nostr-tools & 共通モジュール
    this.nostrTools = window.NostrTools || {};
    this.relayManager = window.relayManager;
    this.nostrAuth = window.nostrAuth;

    // デフォルトリレーリスト
    this.defaultRelays = ['wss://relay.nostr.band', 'wss://nos.lol'];
  }

  /**
   * 初期化
   */
  async init() {
    if (!this._validateDependencies()) {
      console.error('必須の依存関係が見つかりません');
      return;
    }

    this._bindEvents();
    this._updateAuthUI();
    this._log('NostrListManager initialized');
  }

  /**
   * 依存関係の検証
   */
  _validateDependencies() {
    if (!this.nostrTools.nip19 || !this.nostrTools.getPublicKey) {
      console.error('nostr-toolsが未ロードです');
      return false;
    }
    if (!this.relayManager) {
      console.error('RelayManagerが未ロードです');
      return false;
    }
    if (!this.nostrAuth) {
      console.error('NostrAuthが未ロードです');
      return false;
    }
    return true;
  }

  /**
   * イベントリスナーのバインド
   */
  _bindEvents() {
    // メインボタン
    this.elements.fetchEventsButton?.addEventListener('click', () => this.fetchEvents());
    this.elements.showNewListButton?.addEventListener('click', () => this.showNewListForm());
    this.elements.decryptButton?.addEventListener('click', () => this.showDecryptAuthPanel());
    this.elements.generateButton?.addEventListener('click', () => this.generateEvent());
    this.elements.updateButton?.addEventListener('click', () => this.updateEvent());
    this.elements.logoutButton?.addEventListener('click', () => this.logout());

    // 復号認証パネル
    this.elements.decryptWithExtension?.addEventListener('click', () => this.decryptWithExtension());
    this.elements.decryptWithNsec?.addEventListener('click', () => this.decryptWithNsec());
    this.elements.cancelDecrypt?.addEventListener('click', () => this.hideDecryptAuthPanel());

    // 認証状態の変化を監視
    setInterval(() => this._updateAuthUI(), 1000);
  }

  /**
   * 認証UIを更新
   */
  _updateAuthUI() {
    if (!this.nostrAuth.isLoggedIn()) {
      this.elements.authStatusText.textContent = '未ログイン（公開リストのみ閲覧可能）';
      this.elements.authStatus.className = 'auth-status readonly';
      this.elements.logoutButton.style.display = 'none';
      return;
    }

    const npub = this.nostrTools.nip19.npubEncode(this.nostrAuth.pubkey);
    const shortNpub = npub.substring(0, 12) + '...' + npub.slice(-4);

    if (this.nostrAuth.canWrite()) {
      this.elements.authStatusText.textContent = `ログイン中: ${shortNpub} (編集可能)`;
      this.elements.authStatus.className = 'auth-status';
    } else {
      this.elements.authStatusText.textContent = `ログイン中: ${shortNpub} (閲覧のみ)`;
      this.elements.authStatus.className = 'auth-status readonly';
    }

    this.elements.logoutButton.style.display = 'inline-block';
  }

  /**
   * ログアウト
   */
  logout() {
    if (confirm('ログアウトしますか？')) {
      this.nostrAuth.logout();
      this.state.decryptKey = null;
      this._resetForm();
      this._updateAuthUI();
      this._log('ログアウトしました', 'success');
    }
  }

  /**
   * リレーリストを取得
   */
  _getRelayList() {
    const input = this.elements.relayInput?.value?.trim();
    if (!input) {
      return this.defaultRelays;
    }

    const relays = input
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r.startsWith('wss://') || r.startsWith('ws://'));

    return relays.length > 0 ? relays : this.defaultRelays;
  }

  /**
   * イベント取得
   */
  async fetchEvents() {
    if (!this.nostrAuth.isLoggedIn()) {
      alert('リストを読み込むには、まずログインしてください');
      showAuthUI();
      return;
    }

    this._showLoader();
    this._resetEventUI();

    try {
      const pubkey = this.nostrAuth.pubkey;
      const relays = this._getRelayList();

      this._log(`リレーに接続中... (${relays.join(', ')})`);

      // リレーに順番に接続を試行
      let connected = false;
      for (const relayUrl of relays) {
        try {
          await this.relayManager.connect(relayUrl);
          this.state.lastConnectedRelay = relayUrl;
          connected = true;
          this._log(`✅ ${relayUrl} に接続成功`, 'success');
          break;
        } catch (error) {
          this._log(`⚠️ ${relayUrl} への接続失敗: ${error.message}`, 'error');
        }
      }

      if (!connected) {
        throw new Error('すべてのリレーへの接続に失敗しました');
      }

      // イベント購読
      await this._subscribeToEvents(pubkey);

    } catch (error) {
      this._log(`イベント取得エラー: ${error.message}`, 'error');
    } finally {
      this._hideLoader();
    }
  }

  /**
   * イベントを購読
   */
  async _subscribeToEvents(pubkey) {
    return new Promise((resolve, reject) => {
      const events = [];
      const subId = 'kind30000_sub_' + Date.now();

      const handler = (type, data) => {
        if (type === 'EVENT') {
          events.push(data);
        } else if (type === 'EOSE') {
          this.relayManager.unsubscribe(subId);
          this._processEvents(events);
          resolve();
        }
      };

      const filter = { kinds: [30000], authors: [pubkey] };
      const success = this.relayManager.subscribe(subId, filter, handler);

      if (!success) {
        reject(new Error('購読に失敗しました'));
      }

      // タイムアウト設定（10秒）
      setTimeout(() => {
        this.relayManager.unsubscribe(subId);
        if (events.length === 0) {
          reject(new Error('イベント取得タイムアウト'));
        } else {
          this._processEvents(events);
          resolve();
        }
      }, 10000);
    });
  }

  /**
   * 取得したイベントを処理
   */
  _processEvents(events) {
    if (events.length === 0) {
      this._log('kind:30000のイベントが見つかりませんでした', 'error');
      return;
    }

    this.state.eventMap.clear();
    const select = this.elements.dTagSelect;
    const latestByDtag = new Map();

    // dTagごとに最新のイベントだけを残す
    events.forEach(event => {
      const dTag = event.tags.find(t => t[0] === 'd');
      if (dTag) {
        const existing = latestByDtag.get(dTag[1]);
        if (!existing || event.created_at > existing.created_at) {
          latestByDtag.set(dTag[1], event);
        }
      }
    });

    // selectにユニークなdTagだけ追加
    if (select) {
      select.innerHTML = '<option value="">リストを選択してください</option>';
      latestByDtag.forEach((event, dTagValue) => {
        this.state.eventMap.set(event.id, event);
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = dTagValue || event.id;
        select.appendChild(option);
      });
      select.disabled = false;
    }

    if (this.elements.decryptButton) {
      this.elements.decryptButton.disabled = false;
    }
    this._log(`${events.length}件のイベントを取得しました（ユニークdTag=${latestByDtag.size}件）`, 'success');
  }

  /**
   * 復号認証パネルを表示
   */
  showDecryptAuthPanel() {
    const selectedId = this.elements.dTagSelect?.value;
    if (!selectedId) {
      alert('編集するリストを選択してください');
      return;
    }

    this.state.currentEvent = this.state.eventMap.get(selectedId);
    if (!this.state.currentEvent) {
      alert('イベント情報が見つかりません');
      return;
    }

    // 公開リスト（pタグ）は常に表示
    const pTags = this.state.currentEvent.tags.filter(t => t[0] === 'p').map(t => t[1]);
    this.elements.pTagsInput.value = pTags.join('\n');

    // dタグを保持
    const dTag = this.state.currentEvent.tags.find(t => t[0] === 'd');
    if (dTag) {
      this.state.originalDtag = dTag[1];
    }

    // 書き込み権限がある場合は復号パネルを表示
    if (this.nostrAuth.canWrite()) {
      this.elements.decryptAuthPanel.style.display = 'block';
      this.elements.decryptButton.style.display = 'none';
    } else {
      // 閲覧専用の場合は公開リストのみ編集可能
      this.elements.contentInput.value = '（非公開リストは閲覧専用ログインでは表示できません）';
      this.elements.contentInput.disabled = true;
      if (this.elements.generateButton) {
        this.elements.generateButton.disabled = false;
      }
      this._log('公開リストのみ編集できます（非公開リストの編集には秘密鍵が必要です）', 'error');
    }
  }

  /**
   * 復号認証パネルを非表示
   */
  hideDecryptAuthPanel() {
    this.elements.decryptAuthPanel.style.display = 'none';
    this.elements.decryptButton.style.display = 'inline-block';
    this.elements.decryptNsecInput.value = '';
  }

  /**
   * NIP-07拡張機能で復号
   */
  async decryptWithExtension() {
    try {
      if (!window.nostr?.nip04?.decrypt) {
        throw new Error('NIP-07対応の拡張機能が見つかりません');
      }

      await this._performDecryption(null, true);
      this.hideDecryptAuthPanel();
      this._log('拡張機能で復号しました', 'success');

    } catch (error) {
      this._log(`拡張機能での復号エラー: ${error.message}`, 'error');
    }
  }

  /**
   * nsecで復号
   */
  async decryptWithNsec() {
    try {
      const nsec = this.elements.decryptNsecInput?.value?.trim();
      if (!nsec) {
        throw new Error('秘密鍵を入力してください');
      }

      const decoded = this.nostrTools.nip19.decode(nsec);
      if (decoded.type !== 'nsec') {
        throw new Error('無効なnsec形式です');
      }

      await this._performDecryption(decoded.data, false);
      this.hideDecryptAuthPanel();
      this._log('秘密鍵で復号しました', 'success');

    } catch (error) {
      this._log(`復号エラー: ${error.message}`, 'error');
    }
  }

  /**
   * 復号処理の実行
   */
  async _performDecryption(privkey, useExtension) {
    if (!this.state.currentEvent) {
      throw new Error('イベント情報がありません');
    }

    const senderPubkey = this.state.currentEvent.pubkey;
    const ciphertext = this.state.currentEvent.content;

    let decryptedContent;
    if (useExtension) {
      // 拡張機能で復号
      decryptedContent = await window.nostr.nip04.decrypt(senderPubkey, ciphertext);
      this.state.decryptKey = 'extension'; // 拡張機能使用フラグ
    } else {
      // nsecで復号
      decryptedContent = await this.nostrTools.nip04.decrypt(privkey, senderPubkey, ciphertext);
      this.state.decryptKey = privkey; // 秘密鍵を保持
    }

    let decryptedData;
    try {
      decryptedData = JSON.parse(decryptedContent);
    } catch (e) {
      throw new Error('復号結果がJSONとして解釈できません');
    }

    // 公開鍵リストをUIに反映
    const pubkeys = decryptedData.map(tag => tag[1]);
    this.elements.contentInput.value = pubkeys.join('\n');
    this.elements.contentInput.disabled = false;

    if (this.elements.generateButton) {
      this.elements.generateButton.disabled = false;
    }
  }

  /**
   * 新規リストフォームを表示
   */
  showNewListForm() {
    if (!this.nostrAuth.canWrite()) {
      alert('新規リストの作成には秘密鍵での認証が必要です');
      showAuthUI();
      return;
    }

    if (this.elements.newListFormContainer) {
      this.elements.newListFormContainer.style.display = 'block';
      this.elements.newDTagInput?.focus();
    }
    
    // 新規作成時は復号不要なので直接編集可能に
    this.elements.contentInput.disabled = false;
    if (this.elements.generateButton) {
      this.elements.generateButton.disabled = false;
    }
  }

  /**
   * イベントを生成
   */
  async generateEvent() {
    if (!this.nostrAuth.canWrite() && !this.state.decryptKey) {
      alert('イベントの生成には秘密鍵での認証が必要です');
      showAuthUI();
      return;
    }

    this._showLoader();
    try {
      const pubkey = this.nostrAuth.pubkey;
      const newContentPubkeys = this._parsePubkeys(this.elements.contentInput?.value);
      const newPTagsPubkeys = this._parsePubkeys(this.elements.pTagsInput?.value);

      if (newPTagsPubkeys.length === 0) {
        throw new Error('公開リスト(pタグ)に少なくとも1つの公開鍵を入力してください');
      }

      const dtagToUse = this.elements.newDTagInput?.value?.trim() || this.state.originalDtag || 'default';
      if (!dtagToUse) {
        throw new Error('リスト名(dタグ)を入力してください');
      }

      let encryptedContent = '';
      
      // 非公開リストがある場合のみ暗号化
      if (newContentPubkeys.length > 0) {
        const contentTags = newContentPubkeys.map(k => ['p', k]);
        const plaintext = JSON.stringify(contentTags);

        // 暗号化処理
        if (this.state.decryptKey === 'extension') {
          encryptedContent = await window.nostr.nip04.encrypt(pubkey, plaintext);
        } else if (this.state.decryptKey) {
          encryptedContent = await this.nostrTools.nip04.encrypt(this.state.decryptKey, pubkey, plaintext);
        } else if (this.nostrAuth.canWrite()) {
          // NostrAuthから鍵を取得して暗号化
          const event = { kind: 30000, content: '', tags: [], created_at: Math.floor(Date.now() / 1000) };
          const signed = await this.nostrAuth.signEvent(event);
          // 署名できたということは鍵があるので暗号化も可能
          if (this.nostrAuth.nsec) {
            const decoded = this.nostrTools.nip19.decode(this.nostrAuth.nsec);
            encryptedContent = await this.nostrTools.nip04.encrypt(decoded.data, pubkey, plaintext);
          } else if (window.nostr?.nip04?.encrypt) {
            encryptedContent = await window.nostr.nip04.encrypt(pubkey, plaintext);
          }
        } else {
          throw new Error('暗号化に必要な鍵情報が不足しています');
        }
      }

      const event = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dtagToUse], ...newPTagsPubkeys.map(k => ['p', k])],
        content: encryptedContent,
      };

      const signedEvent = await this.nostrAuth.signEvent(event);

      if (this.elements.generatedJsonPre) {
        this.elements.generatedJsonPre.textContent = JSON.stringify(signedEvent, null, 2);
      }
      if (this.elements.updateButton) {
        this.elements.updateButton.disabled = false;
      }

      this._log('JSONイベントを生成しました', 'success');
    } catch (error) {
      this._log(`JSON生成エラー: ${error.message}`, 'error');
    } finally {
      this._hideLoader();
    }
  }

  /**
   * イベントを更新（公開）
   */
  async updateEvent() {
    if (!this.nostrAuth.canWrite()) {
      alert('イベントの送信には秘密鍵での認証が必要です');
      showAuthUI();
      return;
    }

    this._showLoader();
    try {
      if (!this.elements.generatedJsonPre?.textContent) {
        throw new Error('送信するイベントがありません');
      }
      
      const event = JSON.parse(this.elements.generatedJsonPre.textContent);
      const relayUrl = this.state.lastConnectedRelay || this._getRelayList()[0];

      if (!this.relayManager.isConnected() || this.relayManager.url !== relayUrl) {
        await this.relayManager.connect(relayUrl);
      }

      this._log(`イベントを ${relayUrl} に公開中...`);
      this.relayManager.publish(event);

      this._log('イベント送信処理を完了しました', 'success');
      alert(`${relayUrl} に kind:30000 を送信しました!`);

      this._resetForm();
    } catch (error) {
      this._log(`イベント更新エラー: ${error.message}`, 'error');
    } finally {
      this._hideLoader();
    }
  }

  /**
   * フォームをリセット
   */
  _resetForm() {
    if (this.elements.contentInput) {
      this.elements.contentInput.value = '';
      this.elements.contentInput.disabled = false;
    }
    if (this.elements.pTagsInput) this.elements.pTagsInput.value = '';
    if (this.elements.newDTagInput) this.elements.newDTagInput.value = '';
    if (this.elements.dTagSelect) this.elements.dTagSelect.selectedIndex = 0;
    if (this.elements.generatedJsonPre) this.elements.generatedJsonPre.textContent = '';
    if (this.elements.newListFormContainer) this.elements.newListFormContainer.style.display = 'none';
    
    if (this.elements.decryptButton) this.elements.decryptButton.disabled = true;
    if (this.elements.updateButton) this.elements.updateButton.disabled = true;
    if (this.elements.generateButton) this.elements.generateButton.disabled = true;
    
    this.state.decryptKey = null;
    this.hideDecryptAuthPanel();
  }

  /**
   * イベントUI をリセット
   */
  _resetEventUI() {
    const select = this.elements.dTagSelect;
    if (select) {
      select.innerHTML = '<option value="">リストを選択してください</option>';
      select.disabled = true;
    }
    if (this.elements.decryptButton) {
      this.elements.decryptButton.disabled = true;
    }
  }

  /**
   * 公開鍵をパース
   */
  _parsePubkeys(input) {
    if (!input) return [];
    return input
      .split(/[\n, \t]+/)
      .map(k => k.trim())
      .filter(k => k.length === 64);
  }

  /**
   * ローダー表示
   */
  _showLoader() {
    if (this.elements.loader) {
      this.elements.loader.style.display = 'block';
    }
  }

  /**
   * ローダー非表示
   */
  _hideLoader() {
    if (this.elements.loader) {
      this.elements.loader.style.display = 'none';
    }
  }

  /**
   * ログ出力
   */
  _log(message, type = 'info') {
    const colors = {
      error: 'crimson',
      success: 'green',
      info: 'inherit'
    };

    if (type === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }

    if (this.elements.logDiv) {
      const p = document.createElement('div');
      p.textContent = message;
      p.style.color = colors[type] || colors.info;
      p.style.marginBottom = '.25rem';
      this.elements.logDiv.appendChild(p);
      this.elements.logDiv.scrollTop = this.elements.logDiv.scrollHeight;
    }
  }
}

// アプリケーション初期化
(async function() {
  try {
    const manager = new NostrListManager();
    await manager.init();
    console.log('✅ NostrListManager 起動完了');
  } catch (error) {
    console.error('❌ NostrListManager 初期化エラー:', error);
  }
})();