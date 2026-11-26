// Javascriptではキャメルケースが一般的

// ==========================================
// 環境設定（外部読み込み）
// ==========================================
// 現在はCDNから読み込み
import PhotoSwipe from 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.js';
// ==========================================
// 環境設定
// ==========================================
const FOLDER_URL = '/db';   // 画像読み込み先
const API_SERVER = '/api'   // サムネイルロードAPI
const LIMIT = 100;          // サムネイルの一回のロード件数
let observer = null;        // 監視用オブジェクトを格納
// モーダルの要素を定義
const tagsImageModal = document.getElementById('tags-image-modal');

// ==========================================
// グローバル関数（追記用）
// ==========================================
let loadedIdArr = [];   // サムネイルに表示中のidリスト
let offset = 0;         // サムネイルの読み込み済み件数
const imageQueue = [];  // サイズ取得の処理待ちリスト

// ==========================================
// グローバル関数（起動フラグ）
// ==========================================

let photoSwipeAlive = false;       // フォトスワイプの起動中フラグ（追加読み込みの同期、非同期切替に使用）
let getImageSizeQueueAlive = false; // サイズ取得の処理中フラグ
let getImageSizeQueueWait = false;  // サイズ取得の同期/非同期処理選択のフラグ
let firstLoad = true;   // サムネイル初回ロード用フラグ

// ==========================================
// グローバル関数（その他）
// ==========================================
let openedModalId = "1"  // 開いているモーダルのID

// ==========================================
// SVGアイコン
// ==========================================
const SVG_ICON_LINK = `
    <svg class="icon-external" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor"
        stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
`

const SVG_ICON_CLOSE = `
<svg  class="icon-close" width="30" height="30" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
</svg>
`

const SVG_BUTTON_CLOSE =`
    <div style="
        width: 35px;
        height: 35px;
        border-radius: 50%;
        background-color: #333;
        color: #fff;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 0;
        margin: 0;
    ">
        ${SVG_ICON_CLOSE}
    </div>
`

const SVG_ICON_CHECK = `
    <svg class="icon-check" width="13" height="13" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"
        stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
    </svg>    
`

// ==========================================
// ページロード時に起動する関数設定
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadThumbs();
    getTagsList();
    contentAreaButtonSetting();
    headerAreaButtonSetting();
    thumbsSelector();
    batchOperations();
    photoSwipeSetting();
});

// ==========================================
// 関数
// ==========================================

// 初回DOMで起動 フォトスワイプの起動
function photoSwipeSetting() {

    // ページ全体を監視して、クリックされた場所を判定して処理を実施
    document.addEventListener('click', (e) => {
        
        // 各種読み込みに必要なパラメータ
        let dataSource = [];
        // サムネイルを構成する要素自体を格納
        let thumbElements = [];

        // 押されたのがターゲットなら処理
        const targetDiv = e.target.closest('#js-tag-image-modal-img');
        if (targetDiv) {
            e.stopPropagation();
            tagsImageModal.close();
            thumbElements = Array.from(document.querySelectorAll('#js-thumbs-grid .js-thumbs'));
            
            dataSource = thumbElements.map(el => {
                return {
                    src: `${FOLDER_URL}/img/${el.dataset.filename}`,
                    width: parseInt(el.dataset.pswpWidth, 10),
                    height: parseInt(el.dataset.pswpHeight, 10),
                    dataId: el.dataset.id
                };
            });

            const imageId = targetDiv.dataset.id;
            const targetIndex = thumbElements.findIndex(el => el.dataset.id === imageId);
            // 見つからなければ-1を返すのでその場合0を指定
            const safeIndex = targetIndex !== -1 ? targetIndex : 0; 

            // フォトスワイプの持っている最大値、今回は定義だけなので初期値0を代入
            let lastTriggeredCount = 0;

            const pswp = new PhotoSwipe({
                dataSource: dataSource, // 最初の配列を渡す
                index: safeIndex,
                showAnimationDuration: 0,
                loop: false 
            });

            // フォトスワイプの起動フラグ、サムネイル生成関数の非同期・同期切替に使う
            photoSwipeAlive = true;

            // 開いた瞬間に自動でフルスクリーンにする
            pswp.on('openingAnimationStart', () => {
                const pswpElement = pswp.element; // PhotoSwipe全体を囲んでいる要素
                // フォトスワイプを囲む要素がある状態＆ブラウザがフルスクリーン機能を使える状態＆すでにフルスクリーン状態ではない、場合
                if (pswpElement && document.fullscreenEnabled && !document.fullscreenElement) {
                    pswpElement.requestFullscreen().catch(err => {
                        console.log("フルスクリーン要求がブロックされました:", err);
                    });
                }
            });

            pswp.on('change', async () => {

                
                // 現在フォトスワイプが開いてる要素番号（0スタートなので厳密には+1して考える）
                const currentIndex = pswp.currIndex;

                // dataSource.length を使えば、配列が伸びたときに自動で現在のロード済み枚数になる
                const viewAllCount = dataSource.length;      
                
                // 未読み込みを含む最大件数
                const totalCount = parseInt(document.getElementById('js-preview-cnt').dataset.allcount, 10);

                // 追加ロードの基準値、現在は末尾の30枚前
                const thresholdIndex = viewAllCount - 30;

                if (viewAllCount < totalCount && currentIndex > thresholdIndex && viewAllCount > lastTriggeredCount) {
                    lastTriggeredCount = viewAllCount; 
                        
                    getImageSizeQueueWait = true;
                    await loadThumbs(); 

                    // サムネイルから新しく追加された内容をsliceで抽出して、PhotoSwipe用の dataSource に追加
                    thumbElements = Array.from(document.querySelectorAll('#js-thumbs-grid .js-thumbs'));
                    
                    thumbElements.slice(viewAllCount).forEach(el => {
                        dataSource.push({
                            src: `${FOLDER_URL}/img/${el.dataset.filename}`,
                            width: parseInt(el.dataset.pswpWidth, 10),
                            height: parseInt(el.dataset.pswpHeight, 10),
                            dataId: el.dataset.id
                        });
                    });

                }
            });

            // フルスクリーン状態ではなくなったら、PhotoSwipeも閉じる
            const handleFullscreenChange = () => {
                if (!document.fullscreenElement) {
                    pswp.close();
                }
            };
            document.addEventListener('fullscreenchange', handleFullscreenChange);

            // PhotoSwipeが完全に閉じたときの処理
            pswp.on('close', () => {
                // イベントリスナーを削除してメモリを解放にする
                document.removeEventListener('fullscreenchange', handleFullscreenChange);

                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(err => {
                        console.error("フルスクリーン解除エラー:", err);
                    });
                }

                const currentId = dataSource[pswp.currIndex].dataId

                openModal(currentId);
                
            });

            // フォトスワイプの起動
            pswp.init();
        }
    });

}

// 画像サイズを取得してサムネイルにデータ属性で付与
async function processQueue() {
    getImageSizeQueueAlive = true;
    while (imageQueue.length > 0) {
        // 先頭から1つ取り出す（シフト）
        const thumb = imageQueue.shift();

        const filename = thumb.getAttribute('data-filename');

        if (filename) {
            const height = thumb.getAttribute('data-pswp-height');
            const width = thumb.getAttribute('data-pswp-width');

            // すでに何らかの理由でサイズが付いていたらスキップ
            if (Number(height) > 0 && Number(width) > 0) continue;

            const imageUrl = `${FOLDER_URL}/img/${filename}`;

            // 画像の読み込みが終わるまで次の処理を待つ
            await new Promise((resolve) => {
                const img = new Image();
                img.src = imageUrl;

                img.onload = () => {
                    thumb.setAttribute('data-pswp-width', img.naturalWidth);
                    thumb.setAttribute('data-pswp-height', img.naturalHeight);
                    resolve();
                };

                img.onerror = () => {
                    console.error(`この画像に問題発生: ${imageUrl}`);
                    resolve(); // エラーでも止まらないように
                };

            });

        } else console.error(`ファイル名がありません: ${thumb}`);


    }

    getImageSizeQueueAlive = false; // 全て処理し終わったらフラグを戻す
}

// サムネイル生成用関数
async function loadThumbs() {
    try {
        // 表示制限読み込み
        let archived = 'False'
        const archiveSelector = document.getElementById('js-restriction-selector');
        const archiveSelectorState = archiveSelector.classList.contains('js-archived');
        if (archiveSelectorState) {
            archived = 'True';
        }


        // 検索ロジック読み込み
        let logical
        const logicalSelector = document.getElementById('js-logical-selector');
        const logicalSelectorIsActive = logicalSelector.classList.contains('and');
        if (logicalSelectorIsActive) {
            logical = 'AND'
        } else {
            logical = 'OR'
        }


        // ソートタイプ読み込み
        const sortType = document.getElementById('js-sort-type-selector');
        const sortTypeValue = sortType.value;



        let fetchUrl = ``

        const searchBox = document.getElementById('js-search-box');

        const searchStr = searchBox.value.trim().split(/[,\s\u3000]+/).join(',');
        // const searchStr = searchBox.value.trim().split(/[, \u3001]+/).join(',');

        tagListEnable();


        if (searchBox.value) {
            // 検索ワードがあった場合
            fetchUrl = `${API_SERVER}/thumbs/?archived=${archived}&sort=${sortTypeValue}&limit=${LIMIT}&offset=${offset}&search=${searchStr}&logical=${logical}`

        } else {
            // 検索ワードがない場合
            fetchUrl = `${API_SERVER}/thumbs/?archived=${archived}&sort=${sortTypeValue}&limit=${LIMIT}&offset=${offset}`

        }

        const response = await fetch(fetchUrl);

        const data = await response.json();

        if(data.return_cnt > 0) {

            document.getElementById('js-preview-cnt').innerHTML = `${data.hit_cnt} 件表示`;
            document.getElementById('js-preview-cnt').setAttribute('data-allcount', data.hit_cnt);

            const thumbsLoadIdList = [];
            let newThumbsHtml = '';

            // すべての要素をループで処理
            // ↓ここで既に二次配列の表を開いているので、下ではitem[1]でファイル名が拾える
            data.img.forEach(item => {

                // console.log('tag is', item.tag_name)
                const tagString = String(item.tag_name ?? '');
                const archiveExists = tagString.split(',').map(tag => tag.trim()).includes('archived');

                newThumbsHtml += `<div class="js-thumbs" id="js-thumbs-${item.id}" data-id="${item.id}" data-filename="${item.filename}">`

                if (archiveExists) {
                    newThumbsHtml += `<div class="js-thumbs-archived-badge">ARCHIVED</div>`
                }

                newThumbsHtml +=`
                    <div class="js-thumb-check-box js-thumb-check-box-hidden">
                        <div class="js-thumb-check js-thumb-unchecked">${SVG_ICON_CHECK}</div>
                    </div>                    
                ` 
                
                newThumbsHtml += `<img src="${FOLDER_URL}/thumbs/${item.filename}" alt="${item.filename}"/>`
                newThumbsHtml += `</div>`

                // 新規追加分のidリスト
                thumbsLoadIdList.push(`js-thumbs-${item.id}`);
                // 表示中のidリスト
                loadedIdArr.push(item.id);
                
            });

            // まとめてHTMLに流し込む
            const jsThumbsGrid = document.getElementById('js-thumbs-grid');
            // 初回読み込み時
            if (offset < 0) {
                jsThumbsGrid.innerHTML = newThumbsHtml;
            // 2回目以降読み込み時
            } else {
                jsThumbsGrid.insertAdjacentHTML('beforeend', newThumbsHtml)
            }

            // 追加読み込み時の表示済み件数分のオフセット用計算
            offset = offset + LIMIT;

            // 無限スクロールを起動
            infiniteScroll();

            // サイズ計測用対象リストを作成
            thumbsLoadIdList.forEach(id => {
                const thumb = document.getElementById(id);
                if (thumb) {
                    imageQueue.push(thumb);
                }
            });

            // 処理が走っていなければ、バックグラウンド処理を開始
            if (!getImageSizeQueueAlive && getImageSizeQueueWait) {
                // フォトスワイプからのサムネイル追記の場合のみ画像サイズ計測処理を同期する
                await processQueue();   // 同期処理
                getImageSizeQueueWait = false;
            } else {
                processQueue(); //非同期処理
            }
            
        }else {
            // 無限スクロールを停止
            infiniteScroll(true);

            // first_load判定イコール初回ロード時なので、最終ページで更新してクリアしてしまわないように
            if (!document.getElementById('js-thumbs-grid').innerHTML) {
                document.getElementById('js-preview-cnt').innerHTML = `0 件表示`;
                document.getElementById('js-thumbs-grid').innerHTML = `
                    <div class="js-thumbs-empty">
                        <h3>該当する画像が見つかりませんでした</h3>
                        <p style="margin-top:6px; font-size:12px;">検索キーワードやタグ、表示設定を変更してお試しください。</p>
                    </div>
                    `;
            }

            // 停止後の起動は初回起動扱い
            firstLoad = true
        }



    } catch (error) {
        console.error('通信エラー:', error);
    }
}

// モーダルに引数を入れて開く関数
async function openModal(id) {
    // filname,artist,tagsを取得  
    const response = await fetch(`${API_SERVER}/filename/?id=${id}`);   
    const data = await response.json();

    // モーダルに画像を表示
    document.getElementById('js-modal-img').innerHTML =  ` 
        <img id="js-tag-image-modal-img" src="${FOLDER_URL}/img/${data.filename}" alt="${data.filename}" data-id="${id}"/>
        <div role="button" id="js-close-tags-image-modal">${SVG_BUTTON_CLOSE}</div>
    `;

    // 閉じるボタンの動作
    const modalCloseButtonOnclick = document.getElementById('js-close-tags-image-modal');
    modalCloseButtonOnclick.addEventListener('click', () => {
        tagsImageModal.close();
    });

    // モーダルにartistを表示
    document.getElementById('js-modal-info-artist').innerHTML =  ` 
        <ul>
            <li class="js-modal-artist" data-artist="${data.artist}">${data.artist}</li>
            <li><a href="${data.artist_url}" target="_blank" rel="noopener">${SVG_ICON_LINK}ページを開く</a></li>
        </ul>
        `;


    if (data.tags) {

        data.tags.sort((a, b) => {
            // a がターゲットなら前にする (-1)
            if (a === `archived`) return -1;
            // b がターゲットなら前にする (1)
            if (b === `archived`) return 1;
            // それ以外は順番を変えない
            return 0;
        });

        let tagListHtml = "";
        tagListHtml += `<ul id="js-modal-tag-list">`;

        // ↓ここで既に二次配列の表を開いているので、下ではtag[1]でファイル名が拾える
        data.tags.forEach(tag => {
            
            if (tag === `archived`) {
                tagListHtml += `<li class="js-modal-tag" style="color: #ffb15f; font-weight: 700;">${tag}</li>`;
            } else {
                tagListHtml += `<li class="js-modal-tag" data-tag="${tag}">${tag}</li>`;
            }
            
        });

        tagListHtml += `</ul>`;
        // まとめてHTMLに流し込む
        document.getElementById('js-modal-info-tags').innerHTML = tagListHtml;

    }
        
        // モーダルにartistを表示
        document.getElementById('js-modal-info-information').innerHTML =  ` 
            <ul>
                <li>ID: <span class="modal-info-information-span">#${id}</span></li>
                <li>File: <span class="modal-info-information-span" title="${data.filename}">${data.filename}</span></li>
                <li>Posted: <span class="modal-info-information-span">${data.registered_at.slice(0, 10)}</span></li>
                <li>Source: <span class="modal-info-information-span" title="${data.image_url}">
                    <a href="${data.image_url}" target="_blank" rel="noopener">${SVG_ICON_LINK}${data.image_url}</a>
                </span></li>
                <li>pHash: <span class="modal-info-information-span">${data.phash}</span></li>
            </ul>

        `;

        tagsImageModal.showModal(); // モーダルダイアログを開く
        openedModalId = Number(id);
}

// タグ一覧の生成用関数
async function getTagsList() {
    
    const response = await fetch(`${API_SERVER}/tags_list/`);
    const data = await response.json();

    let tagsListHtml = ""
    tagsListHtml = `<ul>`
    data.tags_list.forEach(item => {
        tagsListHtml += `
            <li class="js-tag-list-li" data-tag="${item.tag_name}">${item.tag_name}<span>${item.tag_count}</span></li>
        `;
    });
    tagsListHtml += `</ul>`

    document.getElementById('js-tags-list').innerHTML = tagsListHtml;

} 

// 無限スクロール実装関数
// 監視の解除の時は引数にtrue、起動時は引数無し
function infiniteScroll(stop) {
    if (!stop && !observer){
        // IntersectionObserverは監視用オブジェクトの作成
        observer = new IntersectionObserver(
        
        (entries, observer) => {
            // 初回ロード時は起動だけで次回以降から実施
            if (firstLoad != true) {
                // entriesから中身を取り出してentryとして処理
                entries.forEach(entry => {
                    // 監視対象の要素が監視エリアにいたらtrue
                    if (entry.isIntersecting) {
                        if (!photoSwipeAlive) {
                            loadThumbs();
                        }
                        
                    }
                })
            } else {
                // 初回読み込みキャンセル後にフラグを変更
                firstLoad = false;
            }
        },

        {
            // スクロールする親要素を指定
            root: document.querySelector('#thumbs-grid-area'),
            // IntersectionObserverのオプションを指定
            // 複数件指定の際は変数にまとめて格納もできる、また省略も可能
            rootMargin: '0px 0px 200px 0px'
        }

        );

        const target = document.querySelector('#js-thumbs-end');
        observer.observe(target);
    } else if(stop && observer) {
        observer.disconnect();
        observer = null;
    }
}

// コンテンツエリアのボタン設定
function contentAreaButtonSetting(){
  
    // サムネイルクリックでモーダルを開く設定関数
    const thumbsOnclick = document.getElementById('js-thumbs-grid');
    thumbsOnclick.addEventListener('click', (e) => {
        
        const headerBottom = document.getElementById('js-header-bottom');
        if(headerBottom.classList.contains('js-header-bottom-hidden')) {
            // クリックされた要素、またはその親から .thumbs を探す
            const targetThumbs = e.target.closest('.js-thumbs');

            if (targetThumbs) {
                const imageId = targetThumbs.dataset.id;
                openModal(imageId);
            }                
        }
    });

    // タグ一覧の閉じるボタン設定
    const sidebar = document.getElementById('js-tag-list-area');
    const closeBtn = document.getElementById('js-tag-list-header-close');
    closeBtn.addEventListener('click', () => {
        sidebar.classList.add('tag-list-area-close');
    });           

    // タグ一覧クリックで検索ワードに入力する設定関数
    document.getElementById('js-tags-list').addEventListener('click', (e) => {

        const target = e.target.closest('.js-tag-list-li');

        const searchBox = document.getElementById('js-search-box');
        const searchArr = searchBox.value.trim().split(/[,\s\u3000]+/);            

        if (target) {
            const targetTag = target.dataset.tag;
            const tagExists = searchArr.includes(targetTag);

            // 既に検索窓に入っていれば削除
            if (tagExists) {
                const newSearchArr = searchArr.filter(tag => tag !== targetTag);
                const newSearchStr = newSearchArr.join(', ')
                searchBox.value = newSearchStr
            // まだ検索窓に入っていなければ追加
            } else {
                if (searchBox.value) {
                    // 他の検索ワードが 既にあった場合
                    searchBox.value += `, ${targetTag}`
                } else {
                    // 他の検索ワードがない場合
                    searchBox.value = `${targetTag}`
                }
            }

            searchBox.dispatchEvent(new Event('change'));


            console.log('target_tag:', targetTag);  
        }
    });

    // モーダル内のタグ一覧クリックで検索ワードに入力する設定関数、Tags
    const modalTagListOnclickTagas = document.getElementById('js-modal-info-tags');
    modalTagListOnclickTagas.addEventListener('click', (e) => {

        const target = e.target.closest('.js-modal-tag');

        const searchBox = document.getElementById('js-search-box');
        const searchArr = searchBox.value.trim().split(/[,\s\u3000]+/);            

        if (target) {
            const targetTag = target.dataset.tag;
            const tagExists = searchArr.includes(targetTag);

            // 既に検索窓に入っていれば削除
            if (tagExists) {
                const newSearchArr = searchArr.filter(tag => tag !== targetTag);
                const newSearchStr = newSearchArr.join(', ')
                searchBox.value = newSearchStr
            // まだ検索窓に入っていなければ追加
            } else {
                if (searchBox.value) {
                    // 他の検索ワードが 既にあった場合
                    searchBox.value += `, ${targetTag}`
                } else {
                    // 他の検索ワードがない場合
                    searchBox.value = `${targetTag}`
                }
            }

            searchBox.dispatchEvent(new Event('change'));


            console.log('target_tag:', targetTag);  
        }
    });

    // モーダル内のタグ一覧クリックで検索ワードに入力する設定関数、Artist
    const modalTagListOnclickArtist =document.getElementById('js-modal-info-artist');
    modalTagListOnclickArtist.addEventListener('click', (e) => {

        const target = e.target.closest('.js-modal-artist');
        const searchBox = document.getElementById('js-search-box');
        const searchArr = searchBox.value.trim().split(/[,\s\u3000]+/);            

        if (target) {
            const targetTag = target.dataset.artist;
            const tagExists = searchArr.includes(targetTag);

            // 既に検索窓に入っていれば削除
            if (tagExists) {
                const newSearchArr = searchArr.filter(tag => tag !== targetTag);
                const newSearchStr = newSearchArr.join(', ')
                searchBox.value = newSearchStr
            // まだ検索窓に入っていなければ追加
            } else {
                if (searchBox.value) {
                    // 他の検索ワードが 既にあった場合
                    searchBox.value += `, ${targetTag}`
                } else {
                    // 他の検索ワードがない場合
                    searchBox.value = `${targetTag}`
                }
            }

            searchBox.dispatchEvent(new Event('change'));


            console.log('target_tag:', targetTag);  
        }
    });    

    // タグ画像モーダルでの左右キーの動作
    document.addEventListener('keydown', async(e) => {

        if (tagsImageModal.open) {
            console.log(`表示中は${openedModalId}`);
            // 表示中のid一覧から現在モーダルで表示中のidの順番を調べて基準値にする
            const currentIndex = loadedIdArr.indexOf(openedModalId);
            const loadedIdArrLength = loadedIdArr.length;

            // 押されたキーの種類で分岐
            switch (e.key) {
                case 'ArrowLeft':
                    if (currentIndex - 1 >= 0 ) {
                        console.log(`遷移先は${loadedIdArr[currentIndex - 1]}`);
                        openModal(loadedIdArr[currentIndex - 1]);
                    }

                break;
                
                case 'ArrowRight':
                    if (currentIndex + 1 < loadedIdArrLength ) {
                        console.log(`遷移先は${loadedIdArr[currentIndex + 1]}`);
                        openModal(loadedIdArr[currentIndex + 1]);

                        if (loadedIdArrLength - (currentIndex + 1) < 30) await loadThumbs();
                    }

                break;
            }

        }
    });        
}

// 上部バーのボタン設定
function headerAreaButtonSetting() {
    // タグ一覧の表示切替
    const sidebar = document.getElementById('js-tag-list-area');
    const toggleBtn = document.getElementById('js-tags-selector');
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('tag-list-area-close');
    });    

    // archived_modeセレクターの切替
    const restrictionSelector = document.getElementById('js-restriction-selector');
    restrictionSelector.addEventListener('click', () => {
        const isActive = restrictionSelector.classList.toggle('js-archived');
        if (isActive) {
            restrictionSelector.textContent = 'ARCHIVED';
        } else {
            restrictionSelector.textContent = 'GALLERY';
        }

        thumbsReset();
    });    

    // ロジカルセレクターの切替
    const logicalSelector = document.getElementById('js-logical-selector');
    logicalSelector.addEventListener('click', () => {
        const isActive = logicalSelector.classList.toggle('and');
        if (isActive) {
            logicalSelector.textContent = 'AND検索';
        } else {
            logicalSelector.textContent = 'OR検索';
        }
        
        thumbsReset();
    });   
    
    // ソートセレクターの切替
    const sortTypeSelector = document.getElementById('js-sort-type-selector');
    sortTypeSelector.addEventListener('change', () => {
        thumbsReset();
    });   
    
    // 検索窓の動作、検索窓に入力があった場合（要エンター）
    const searchBox = document.getElementById('js-search-box');
    searchBox.addEventListener('change', () => {
        thumbsReset();
        tagListEnable();
    });

    // 検索窓の動作、検索窓クリアボタンの動作
    const searchBoxClear = document.getElementById('js-search-box-clear');
    searchBoxClear.addEventListener('click', () => {
        searchBox.value = "";
        thumbsReset();
    });


}

// サムネイルリセット関数
function thumbsReset() {
    //  サムネイルの表示中件数（追記用）のリセット
    offset = 0;
    // 初回ロード用フラグをリセット
    firstLoad = true;
    // サムネイルをリセット
    document.getElementById('js-thumbs-grid').innerHTML = '';
    // ロード済みidリストをリセット
    loadedIdArr = [];
    // リセット後に再読み込み
    loadThumbs();        
}

// 検索ワードに入っているタグリストの内容をハイライト
function tagListEnable() {

        const searchTags = document.getElementById('js-search-box');
        const searchArr = searchTags.value.trim().split(/[,\s\u3000]+/);

        // js-tags-listの配下のカスタムデータ属性持ちを全件取得
        const listAll = document.getElementById('js-tags-list').querySelectorAll('[data-tag]');

        listAll.forEach(list_li => {
            // 各リストのタグ情報を取得
            const listTag = list_li.dataset.tag;

            // 検索窓のテキストと比較してあればクラス付与、なければクラス削除
            if(searchArr.includes(listTag)) {
                list_li.classList.add('js-tag-enable');
            } else {
                list_li.classList.remove('js-tag-enable');
            }
        });

}

// サムネイルクリックで選択関数    
function thumbsSelector() {

    // サムネイル選択モードの開始、終了（サムネイル生成時に付与したチェックボックスの非表示を解除）
    document.getElementById('js-thumbs-selector').addEventListener('click', (e) => {

        const headerBottom = document.getElementById('js-header-bottom');
        const headerBottomStatus = headerBottom.classList.toggle('js-header-bottom-hidden');

        const thumbsGrid = document.querySelectorAll('#js-thumbs-grid > *');

        if(!headerBottomStatus) {

            thumbsGrid.forEach(thumb => {
                thumb.querySelector('.js-thumb-check-box').classList.remove('js-thumb-check-box-hidden');
            }); 

        } else {
            thumbsSelectorEnd();
        }

    });

    // サムネイル選択する関数（選択したサムネイル選択済みクラスをトグル）、ページロード時などに一度だけ親要素に登録する
    document.getElementById('js-thumbs-grid').addEventListener('click', (e) => {

        const headerBottom = document.getElementById('js-header-bottom');
        const headerBottomStatus = headerBottom.classList.contains('js-header-bottom-hidden');

        if(!headerBottomStatus) {

            // クリックされた要素、またはその親から .thumbs を探す
            const targetThumbs = e.target.closest('.js-thumbs');

            if (targetThumbs) {
                targetThumbs.querySelector('.js-thumb-check-box').classList.toggle('js-thumb-check-box-selected');
                targetThumbs.querySelector('.js-thumb-check').classList.toggle('js-thumb-unchecked');
                targetThumbs.classList.toggle('js-thumb-checked');
            }
        };       
    });
}

// サムネイル選択でのチェックを外して、チェックボックスを非表示に戻す
function thumbsSelectorEnd() {
    const thumbsGrid = document.querySelectorAll('#js-thumbs-grid > *');
    thumbsGrid.forEach(thumb => {

        thumb.querySelector('.js-thumb-check-box').classList.remove('js-thumb-check-box-selected');
        thumb.querySelector('.js-thumb-check-box').classList.add('js-thumb-check-box-hidden');
        thumb.querySelector('.js-thumb-check').classList.add('js-thumb-unchecked');
        thumb.classList.remove('js-thumb-checked');
        
    });         
}

// 画像ダウンロード関数
function batchOperations() {
    document.getElementById('js-header-bottom-dl').addEventListener('click', async() => {
        const selectedFilenameArr =[];
        const thumbsGridArea = document.getElementById('js-thumbs-grid');
        const thumbsSelected = thumbsGridArea.querySelectorAll('.js-thumb-checked')
        
        if (thumbsSelected.length > 0) {

            thumbsSelected.forEach(thumb => {
                selectedFilenameArr.push(thumb.dataset.filename);
            });

            console.log('選択filename', selectedFilenameArr);

            // 待たされ感を出さないように先に選択モードを閉じる
            thumbsSelectorEnd();
            document.getElementById('js-header-bottom').classList.toggle('js-header-bottom-hidden')

            // 1. JSZipのインスタンスを作成
            const zip = new JSZip();
            // ZIP内のフォルダ名（任意）
            const imgFolder = zip.folder("images");

            // 2. すべての画像を並行してフェッチし、ZIPに追加
            const promises = selectedFilenameArr.map(async (filename) => {

                    // ファイル名をフルパスに加工
                    const url = `./db/img/${filename}`
                    // ファイルを取得
                    const response = await fetch(url);

                    // throw new Error()で強制停止させないと、画像以外のエラーコードから次のステップで.blobしてしまう
                    if (!response.ok) throw new Error(`fetch(${url})でエラー status: ${response.status}`);
                    
                    // .blobは画像などのバイナリデータを取得する
                    const blob = await response.blob();
                    
                    
                    // ZIPフォルダにファイルを追加
                    imgFolder.file(filename, blob);

            });

            // すべての処理が完了するのを待つ
            await Promise.all(promises);

            // 3. ZIPファイルを生成してダウンロード

            const content = await zip.generateAsync({ type: "blob" });
            
            // ダウンロード用のリンクを一時的に作成してクリック
            // 要素を作成
            const link = document.createElement("a");
            // herf属性を付与
            link.href = URL.createObjectURL(content);
            // download属性を付与、バイナリデータを指定しているので名前も拡張子もないので
            link.download = 'images.zip';

            // 作った要素をDOMに追加して、クリックして、削除
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // メモリ解放しないといつまでも残る
            URL.revokeObjectURL(link.href);

        } else {

            // 閉じる
            thumbsSelectorEnd();
            document.getElementById('js-header-bottom').classList.toggle('js-header-bottom-hidden')                

        }
    });
}