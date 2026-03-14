import * as vscode from 'vscode';
import * as http from 'http';

export function activate(context: vscode.ExtensionContext) {

    const disposable = vscode.commands.registerCommand('bingevibe.helloWorld', async () => {

        let apiKey = await context.secrets.get('bingevibe.ytApiKey');

        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your YouTube Data API v3 key',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'AIzaSy...'
            });

            if (!apiKey) {
                vscode.window.showErrorMessage('BingeVibe: No API key provided.');
                return;
            }

            await context.secrets.store('bingevibe.ytApiKey', apiKey);
            vscode.window.showInformationMessage('BingeVibe: API key saved!');
        }

        const query = await vscode.window.showInputBox({
            prompt: 'Search YouTube Shorts (leave blank for trending)',
            ignoreFocusOut: true,
            placeHolder: 'e.g. funny cats, cooking, travel...'
        });

        if (query === undefined) { return; }

        vscode.window.showInformationMessage('BingeVibe: Fetching Shorts...');
        let result = await fetchShorts(apiKey, query || 'shorts');

        if (result.ids.length === 0) {
            vscode.window.showErrorMessage('BingeVibe: No embeddable Shorts found. Try a different search.');
            return;
        }

        const port = await startLocalServer(context);

        const panel = vscode.window.createWebviewPanel(
            'bingeVibe',
            'BingeVibe',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right, 100
        );
        statusBar.text = '$(play) BingeVibe: Video 1';
        statusBar.show();

        let nextPageToken: string | undefined = result.nextPageToken;
        let isFetching = false;

        panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'videoChanged') {
                    statusBar.text = `$(play) BingeVibe: Video ${message.index + 1}`;
                }

                if (message.command === 'fetchMore' && !isFetching) {
                    if (!nextPageToken) {
                        panel.webview.postMessage({ command: 'noMore' });
                        return;
                    }
                    isFetching = true;
                    try {
                        const more = await fetchShorts(apiKey!, query || 'shorts', nextPageToken);
                        nextPageToken = more.nextPageToken;
                        panel.webview.postMessage({ command: 'moreVideos', ids: more.ids });
                    } catch {
                        vscode.window.showErrorMessage('BingeVibe: Failed to fetch more videos.');
                    } finally {
                        isFetching = false;
                    }
                }
            },
            undefined,
            context.subscriptions
        );

        let resumeTimer: ReturnType<typeof setTimeout> | undefined;

        const typingListener = vscode.workspace.onDidChangeTextDocument(() => {
            panel.webview.postMessage({ command: 'pause' });
            if (resumeTimer) { clearTimeout(resumeTimer); }
            resumeTimer = setTimeout(() => {
                panel.webview.postMessage({ command: 'resume' });
            }, 3000);
        });

        panel.onDidDispose(() => {
            if (resumeTimer) { clearTimeout(resumeTimer); }
            typingListener.dispose();
            statusBar.dispose();
        });

        panel.webview.html = getWebviewContent(panel.webview, port, result.ids);
    });

    const resetKey = vscode.commands.registerCommand('bingevibe.resetApiKey', async () => {
        await context.secrets.delete('bingevibe.ytApiKey');
        vscode.window.showInformationMessage('BingeVibe: API key cleared.');
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(resetKey);
}

async function fetchShorts(
    apiKey: string,
    query: string,
    pageToken?: string
): Promise<{ ids: string[]; nextPageToken?: string }> {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'id');
    searchUrl.searchParams.set('q', query + ' #shorts');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('videoDuration', 'short');
    searchUrl.searchParams.set('maxResults', '50');
    if (pageToken) { searchUrl.searchParams.set('pageToken', pageToken); }
    searchUrl.searchParams.set('key', apiKey);

    const searchResp = await fetch(searchUrl.toString());
    if (!searchResp.ok) {
        const err = await searchResp.json() as any;
        throw new Error(err?.error?.message ?? 'YouTube search API error');
    }
    const searchData = await searchResp.json() as any;
    const allIds: string[] = searchData.items
        .map((item: any) => item?.id?.videoId)
        .filter(Boolean);

    const embeddableIds = await filterEmbeddable(apiKey, allIds);
    return { ids: embeddableIds, nextPageToken: searchData.nextPageToken };
}

async function filterEmbeddable(apiKey: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) { return []; }
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'status');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('key', apiKey);

    const resp = await fetch(url.toString());
    if (!resp.ok) { return ids; }
    const data = await resp.json() as any;

    return data.items
        .filter((item: any) => item?.status?.embeddable === true)
        .map((item: any) => item.id);
}

function startLocalServer(context: vscode.ExtensionContext): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url!, 'http://localhost');
            const videoId = url.searchParams.get('v') ?? '';

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; }
        html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
        #yt { width: 100%; height: 100%; }
        #sound-overlay {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            padding-bottom: 32px;
            pointer-events: none;
            z-index: 10;
        }
        #sound-btn {
            pointer-events: all;
            background: rgba(0,0,0,0.75);
            color: #fff;
            border: none;
            border-radius: 24px;
            padding: 10px 22px;
            font-size: 15px;
            cursor: pointer;
            backdrop-filter: blur(4px);
        }
    </style>
</head>
<body>
    <div id="yt"></div>
    <div id="sound-overlay">
        <button id="sound-btn">🔇 Tap for sound</button>
    </div>
    <script>
        var player;

        var tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        function onYouTubeIframeAPIReady() {
            player = new YT.Player('yt', {
                videoId: '${videoId}',
                width: '100%',
                height: '100%',
                playerVars: { autoplay: 1, mute: 1, controls: 1, rel: 0, playsinline: 1 },
                events: {
                    onError: function() {
                        window.parent.postMessage({ type: 'playerError' }, '*');
                    }
                }
            });
        }

        document.getElementById('sound-btn').addEventListener('click', function() {
            if (player && player.unMute) {
                player.unMute();
                player.setVolume(100);
                player.playVideo();
            }
            document.getElementById('sound-overlay').style.display = 'none';
        });

        window.addEventListener('message', function(e) {
            var msg = e.data;
            if (!player) { return; }

            if (msg && msg.videoId && player.loadVideoById) {
                player.loadVideoById(msg.videoId);
                player.unMute();
                player.setVolume(100);
                document.getElementById('sound-overlay').style.display = 'none';
            }

            if (msg && msg.cmd === 'pause') {
                player.pauseVideo();
            }

            if (msg && msg.cmd === 'resume') {
                player.playVideo();
            }
        });
    </script>
</body>
</html>`);
        });

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            context.subscriptions.push({ dispose: () => server.close() });
            resolve(port);
        });

        server.on('error', reject);
    });
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars[Math.floor(Math.random() * chars.length)];
    }
    return text;
}

function getWebviewContent(
    webview: vscode.Webview,
    port: number,
    videoIds: string[]
): string {
    const nonce = getNonce();
    const baseUrl = `http://127.0.0.1:${port}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   script-src 'nonce-${nonce}';
                   frame-src http://127.0.0.1:${port};
                   style-src 'unsafe-inline' ${webview.cspSource};
                   img-src https: data: ${webview.cspSource};">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #1e1e1e;
            color: white;
            font-family: sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            gap: 16px;
            height: 100vh;
        }
        h2 { color: #ff4444; font-size: 18px; }
        .player-container {
            width: 100%;
            max-width: 380px;
            aspect-ratio: 9/16;
            background: #000;
            border-radius: 12px;
            overflow: hidden;
        }
        #player { width: 100%; height: 100%; border: none; display: block; }
        .controls { display: flex; gap: 12px; }
        button {
            background: #ff4444;
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover { background: #cc3333; }
        button:disabled { background: #555; cursor: default; }
        .video-count { font-size: 12px; color: #888; }
    </style>
</head>
<body>
    <h2>BingeVibe</h2>
    <div class="player-container">
        <iframe id="player"
            src="${baseUrl}/?v=${videoIds[0]}"
            allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
        </iframe>
    </div>
    <div class="controls">
        <button id="btn-prev">Prev</button>
        <button id="btn-next">Next</button>
    </div>
    <div class="video-count" id="count">1 / ${videoIds.length}</div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let videos = ${JSON.stringify(videoIds)};
        let current = 0;

        function getPlayer() {
            return document.getElementById('player');
        }

        function navigateTo(index) {
            getPlayer().contentWindow.postMessage({ videoId: videos[index] }, '*');
            document.getElementById('count').textContent = (index + 1) + ' / ' + videos.length;
            vscode.postMessage({ command: 'videoChanged', index });
        }

        function maybeLoadMore() {
            if (current >= videos.length - 5) {
                document.getElementById('btn-next').disabled = true;
                vscode.postMessage({ command: 'fetchMore' });
            }
        }

        document.getElementById('btn-next').addEventListener('click', () => {
            current = (current + 1) % videos.length;
            navigateTo(current);
            maybeLoadMore();
        });

        document.getElementById('btn-prev').addEventListener('click', () => {
            current = (current - 1 + videos.length) % videos.length;
            navigateTo(current);
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;

            if (msg?.type === 'playerError') {
                current = (current + 1) % videos.length;
                navigateTo(current);
            }

            if (msg?.command === 'moreVideos') {
                videos = videos.concat(msg.ids);
                document.getElementById('btn-next').disabled = false;
                document.getElementById('count').textContent =
                    (current + 1) + ' / ' + videos.length;
            }

            if (msg?.command === 'noMore') {
                document.getElementById('btn-next').disabled = false;
            }

            if (msg?.command === 'pause') {
                getPlayer().contentWindow.postMessage({ cmd: 'pause' }, '*');
            }

            if (msg?.command === 'resume') {
                getPlayer().contentWindow.postMessage({ cmd: 'resume' }, '*');
            }
        });
    </script>
</body>
</html>`;
}

export function deactivate() {}
