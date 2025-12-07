/**
 * Nostr kind:30000 List Manager
 * RelayManagerを使用してリレーとの通信を管理
 */
class NostrListManager {
  constructor() {
    // DOM要素
    this.elements = {
      nsecInput: document.getElementById('nsecInput'),
      npubDisplay: document.getElementById('npubDisplay'),
      hexDisplay: document.getElementById('hexDisplay'),
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
      getFromExtensionButton: document.getElementById('getFromExtensionButton')
    };

    // 状態管理
    this.state = {
      eventMap: new Map(),
      currentEvent: null,
      originalPubkeysFromPtag: [],
      originalDtag: '',
      lastConnectedRelay: ''
    };

    // nostr-tools ショートカット
    this.nostrTools = window.NostrTools || {};
    this.relayManager = window.relayManager;

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
    this._initializeNsecInput();
    this._log('NostrListManager initialized');
  }

  /**
   * 依存関係の検証
   */
  _validateDependencies() {
    if (!this.elements.nsecInput || !this.elements.npubDisplay || !this.elements.hexDisplay) {
      console.error('必須のDOM要素が見つかりません');
      return false;
    }
    if (!this.nostrTools.nip19 || !this.nostrTools.getPublicKey) {
      console.error('nostr-toolsが未ロードです');
      return false;
    }
    if (!this.relayManager) {
      console.error('RelayManagerが未ロードです');
      return false;
    }
    return true;
  }

  /**
   * イベントリスナーのバインド
   */
  _bindEvents() {
    // ボタンイベント
    this.elements.fetchEventsButton?.addEventListener('click', () => this.fetchEvents());
    this.elements.showNewListButton?.addEventListener('click', () => this.showNewListForm());
    this.elements.decryptButton?.addEventListener('click', () => this.decryptContent());
    this.elements.generateButton?.addEventListener('click', () => this.generateEvent());
    this.elements.updateButton?.addEventListener('click', () => this.updateEvent());
    this.elements.getFromExtensionButton?.addEventListener('click', () => this.getFromExtension());

    // nsec入力の監視
    this.elements.nsecInput?.addEventListener('input', () => this._handleNsecInput());
  }

  /**
   * nsec入力の初期化
   */
  _initializeNsecInput() {
    const nsecVal = this.elements.nsecInput?.value?.trim();
    if (nsecVal) {
      this._handleNsecInput();
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
   * Nostr鍵を取得（NIP-07 or nsec）
   */
  async _getNostrKeys() {
    try {
      // NIP-07拡張機能を優先
      if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
        const pubkey = await window.nostr.getPublicKey();
        return { pubkey, privkey: null, isExtension: true };
      }

      // nsecから取得
      const nsec = this.elements.nsecInput?.value?.trim();
      if (!nsec) {
        throw new Error('nsecを入力するか、NIP-07拡張機能を有効にしてください');
      }

      const decoded = this.nostrTools.nip19.decode(nsec);
      if (decoded.type !== 'nsec') {
        throw new Error('無効なnsec形式です');
      }

      const privkey = decoded.data;
      const pubkey = this.nostrTools.getPublicKey(privkey);
      return { pubkey, privkey, isExtension: false };

    } catch (error) {
      throw new Error(`鍵の取得に失敗: ${error.message}`);
    }
  }

  /**
   * 拡張機能から公開鍵を取得
   */
  async getFromExtension() {
    try {
      if (!window.nostr || typeof window.nostr.getPublicKey !== 'function') {
        alert('NIP-07対応の拡張機能が見つかりません');
        return;
      }

      const pubkey = await window.nostr.getPublicKey();
      if (!pubkey) {
        throw new Error('公開鍵の取得に失敗しました');
      }

      const npub = this.nostrTools.nip19.npubEncode(pubkey);
      this.elements.npubDisplay.textContent = npub;
      this.elements.hexDisplay.textContent = pubkey;
      
      if (this.elements.nsecInput) {
        this.elements.nsecInput.value = '';
        this.elements.nsecInput.disabled = true;
      }

      this._log('拡張機能から公開鍵を取得しました', 'success');
    } catch (error) {
      this._log(`拡張機能エラー: ${error.message}`, 'error');
    }
  }

  /**
   * nsec入力ハンドラー
   */
  _handleNsecInput() {
    const nsecValue = this.elements.nsecInput?.value?.trim();
    if (!nsecValue) {
      this.elements.npubDisplay.textContent = '';
      this.elements.hexDisplay.textContent = '';
      if (this.elements.nsecInput) {
        this.elements.nsecInput.disabled = false;
      }
      return;
    }

    try {
      const decoded = this.nostrTools.nip19.decode(nsecValue);
      if (decoded?.type === 'nsec') {
        const pubkey = this.nostrTools.getPublicKey(decoded.data);
        const npub = this.nostrTools.nip19.npubEncode(pubkey);
        this.elements.npubDisplay.textContent = npub;
        this.elements.hexDisplay.textContent = pubkey;
      }
    } catch (error) {
      this.elements.npubDisplay.textContent = '';
      this.elements.hexDisplay.textContent = '';
    }
  }

  /**
   * イベント取得
   */
  async fetchEvents() {
    this._showLoader();
    this._resetEventUI();

    try {
      const { pubkey } = await this._getNostrKeys();
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

    events.forEach(event => {
      const dTag = event.tags.find(t => t[0] === 'd');
      if (dTag) {
        this.state.eventMap.set(event.id, event);
        if (select) {
          const option = document.createElement('option');
          option.value = event.id;
          option.textContent = dTag[1] || event.id;
          select.appendChild(option);
        }
      }
    });

    if (select) {
      select.disabled = false;
    }
    if (this.elements.decryptButton) {
      this.elements.decryptButton.disabled = false;
    }

    this._log(`${events.length}件のイベントを取得しました`, 'success');
  }

  /**
   * コンテンツを復号
   */
  async decryptContent() {
  this._showLoader();
  try {
    const selectedId = this.elements.dTagSelect?.value;
    if (!selectedId) throw new Error('イベントを選択してください');

    this.state.currentEvent = this.state.eventMap.get(selectedId);
    if (!this.state.currentEvent) throw new Error('イベント情報が見つかりません');

    const { privkey } = await this._getNostrKeys();
    const senderPubkey = this.state.currentEvent.pubkey;
    const decryptedContent = await this._decryptPreferExtension(senderPubkey,
      this.state.currentEvent.content, privkey);

    let decryptedData;
    try {
      decryptedData = JSON.parse(decryptedContent);
    } catch (e) {
      throw new Error('復号結果がJSONとして解釈できません');
    }

    // 公開鍵リストをUIに反映
    const pubkeys = decryptedData.map(tag => tag[1]);
    this.elements.contentInput.value = pubkeys.join('\n');
    this.elements.pTagsInput.value = this.state.currentEvent.tags.filter(t => t[0] === 'p').map(t => t[1]).join('\n');

    // ✅ dタグを保持
    const dTag = this.state.currentEvent.tags.find(t => t[0] === 'd');
    if (dTag) {
      this.state.originalDtag = dTag[1];
    }

    if (this.elements.generateButton) this.elements.generateButton.disabled = false;
    this._log('イベントを正常に復号しました', 'success');
  } catch (error) {
    this._log(`復号エラー: ${error.message}`, 'error');
  } finally {
    this._hideLoader();
  }
}

  /**
   * 新規リストフォームを表示
   */
  showNewListForm() {
    if (this.elements.newListFormContainer) {
      this.elements.newListFormContainer.style.display = 'block';
      this.elements.newDTagInput?.focus();
    }
    if (this.elements.generateButton) {
      this.elements.generateButton.disabled = false;
    }
  }

  /**
   * イベントを生成
   */
  async generateEvent() {
  this._showLoader();
  try {
    const { pubkey, privkey } = await this._getNostrKeys();

    const newContentPubkeys = this._parsePubkeys(this.elements.contentInput?.value);
    const newPTagsPubkeys = this._parsePubkeys(this.elements.pTagsInput?.value);

    if (newContentPubkeys.length === 0 || newPTagsPubkeys.length === 0) {
      throw new Error('contentまたはpタグに公開鍵を入力してください');
    }

    const dtagToUse = this.elements.newDTagInput?.value?.trim() || this.state.originalDtag || 'default';
    if (!dtagToUse) throw new Error('dタグ(リスト名)を入力してください');

    const contentTags = newContentPubkeys.map(k => ['p', k]);

    const encryptedContent = await this._encryptPreferExtension(
      pubkey,
      JSON.stringify(contentTags),
      privkey
    );

    const event = {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', dtagToUse], ...newPTagsPubkeys.map(k => ['p', k])],
      content: encryptedContent,
    };

    const signedEvent = await this._signEventPreferExtension(event, privkey);

    if (this.elements.generatedJsonPre) {
      this.elements.generatedJsonPre.textContent = JSON.stringify(signedEvent, null, 2);
    }
    if (this.elements.updateButton) this.elements.updateButton.disabled = false;

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
    this._showLoader();

    try {
      if (!this.elements.generatedJsonPre?.textContent) {
        throw new Error('送信するイベントがありません');
      }

      const event = JSON.parse(this.elements.generatedJsonPre.textContent);
      
      // 最後に接続したリレーまたはデフォルトを使用
      const relayUrl = this.state.lastConnectedRelay || this._getRelayList()[0];

      // リレーに接続
      if (!this.relayManager.isConnected() || this.relayManager.url !== relayUrl) {
        await this.relayManager.connect(relayUrl);
      }

      this._log(`イベントを ${relayUrl} に公開中...`);

      // イベントを公開
      this.relayManager.publish(event);

      // 公開結果を待機（OKメッセージを購読）
      await this._waitForPublishResult(event.id);

      alert(`${relayUrl} に kind:30000 を送信しました!`);
      this._resetForm();

    } catch (error) {
      this._log(`イベント更新エラー: ${error.message}`, 'error');
    } finally {
      this._hideLoader();
    }
  }

  /**
   * 公開結果を待機
   */
  async _waitForPublishResult(eventId) {
    return new Promise((resolve, reject) => {
      const subId = 'ok_sub_' + Date.now();
      let resolved = false;

      const handler = (type, data) => {
        if (type === 'OK' && !resolved) {
          resolved = true;
          this.relayManager.unsubscribe(subId);
          
          if (data[1] === eventId) {
            if (data[2]) {
              this._log('イベントは正常に公開されました!', 'success');
              resolve();
            } else {
              reject(new Error(`公開失敗: ${data[3] || 'unknown'}`));
            }
          }
        }
      };

      // OKメッセージの購読は通常のREQとは異なるため、
      // RelayManagerのメッセージハンドラーで処理されることを期待
      // タイムアウトのみ設定
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this._log('公開結果の確認がタイムアウトしました（送信は完了している可能性があります）', 'error');
          resolve(); // エラーではなく完了扱い
        }
      }, 5000);
    });
  }

  /**
   * フォームをリセット
   */
  _resetForm() {
    if (this.elements.contentInput) this.elements.contentInput.value = '';
    if (this.elements.pTagsInput) this.elements.pTagsInput.value = '';
    if (this.elements.newDTagInput) this.elements.newDTagInput.value = '';
    if (this.elements.dTagSelect) this.elements.dTagSelect.selectedIndex = 0;
    if (this.elements.generatedJsonPre) this.elements.generatedJsonPre.textContent = '';
    
    if (this.elements.decryptButton) this.elements.decryptButton.disabled = true;
    if (this.elements.updateButton) this.elements.updateButton.disabled = true;
    if (this.elements.generateButton) this.elements.generateButton.disabled = true;
  }

  /**
   * イベントUI をリセット
   */
  _resetEventUI() {
    const select = this.elements.dTagSelect;
    if (select) {
      select.innerHTML = '<option value="">dタグを選択してください</option>';
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
   * 暗号化（拡張機能優先）
   */
  async _encryptPreferExtension(theirPubkey, plaintext, privkey) {
    try {
      if (window.nostr?.nip04?.encrypt) {
        try {
          return await window.nostr.nip04.encrypt(theirPubkey, plaintext);
        } catch (e) {
          return await window.nostr.nip04.encrypt(plaintext, theirPubkey);
        }
      }
    } catch (error) {
      console.warn('拡張機能での暗号化失敗:', error);
    }
    return await this.nostrTools.nip04.encrypt(privkey, theirPubkey, plaintext);
  }

  /**
   * 復号（拡張機能優先）
   */
  async _decryptPreferExtension(theirPubkey, ciphertext, privkey) {
    try {
      if (window.nostr?.nip04?.decrypt) {
        try {
          return await window.nostr.nip04.decrypt(theirPubkey, ciphertext);
        } catch (e) {
          return await window.nostr.nip04.decrypt(ciphertext, theirPubkey);
        }
      }
    } catch (error) {
      console.warn('拡張機能での復号失敗:', error);
    }
    return await this.nostrTools.nip04.decrypt(privkey, theirPubkey, ciphertext);
  }

  /**
   * 署名（拡張機能優先）
   */
  async _signEventPreferExtension(event, privkey) {
    try {
      if (window.nostr?.signEvent) {
        const res = await window.nostr.signEvent(event);
        if (res?.id && res?.sig && res?.pubkey) {
          return res;
        }
      }
    } catch (error) {
      console.warn('拡張機能での署名失敗:', error);
    }
    return this.nostrTools.finalizeEvent(event, privkey);
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