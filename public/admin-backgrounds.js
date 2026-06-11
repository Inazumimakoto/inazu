(() => {
    'use strict';

    const AREAS = [
        { id: 'inbox', label: '未分類 (inbox)', note: 'とりあえずここに追加して、あとで振り分けできます。未分類の写真はサイトには表示されません。' },
        { id: 'morning', label: '朝 (morning)' },
        { id: 'lunch', label: '昼 (lunch)' },
        { id: 'night', label: '夜 (night)' }
    ];
    const MOVE_LABELS = { inbox: '未分類へ', morning: '朝へ', lunch: '昼へ', night: '夜へ' };

    const slotsRoot = document.querySelector('[data-slots]');
    const sections = new Map();

    function buildAreaSection(area) {
        const section = document.createElement('section');
        section.className = 'panel panel-wide';
        section.innerHTML = `
            <div class="panel-heading">
                <h2></h2>
                <span class="panel-meta" data-count>Loading</span>
            </div>
            <div class="slot-toolbar">
                <input type="file" data-file-input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple hidden>
                <button type="button" class="upload-button" data-upload>写真を追加</button>
                <span class="slot-status" data-status></span>
            </div>
            <div class="photo-grid" data-grid></div>
        `;
        section.querySelector('h2').textContent = area.label;

        if (area.note) {
            const note = document.createElement('p');
            note.className = 'slot-note';
            note.textContent = area.note;
            section.querySelector('.panel-heading').after(note);
        }

        const fileInput = section.querySelector('[data-file-input]');
        const uploadButton = section.querySelector('[data-upload]');

        uploadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadPhotos(area.id, fileInput.files);
                fileInput.value = '';
            }
        });

        slotsRoot.appendChild(section);
        sections.set(area.id, section);
    }

    function setStatus(areaId, message, isError = false) {
        const status = sections.get(areaId).querySelector('[data-status]');
        status.textContent = message;
        status.style.color = isError ? '#ff9a9a' : '';
    }

    function renderArea(areaId, photos) {
        const section = sections.get(areaId);
        const grid = section.querySelector('[data-grid]');
        section.querySelector('[data-count]').textContent = `${photos.length} photos`;
        grid.replaceChildren();

        if (photos.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'photo-empty';
            empty.textContent = areaId === 'inbox' ? '未分類の写真はありません。' : 'まだ写真がありません。';
            grid.appendChild(empty);
            return;
        }

        for (const photo of photos) {
            const filename = decodeURIComponent(photo.split('/').pop());
            const card = document.createElement('div');
            card.className = 'photo-card';

            const img = document.createElement('img');
            img.src = `/${photo}`;
            img.alt = filename;
            img.loading = 'lazy';

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'photo-delete';
            remove.textContent = '削除';
            remove.addEventListener('click', () => deletePhoto(areaId, filename));

            const footer = document.createElement('div');
            footer.className = 'photo-actions';
            for (const target of AREAS) {
                if (target.id === areaId) continue;

                const move = document.createElement('button');
                move.type = 'button';
                move.className = 'photo-move';
                move.textContent = MOVE_LABELS[target.id];
                move.addEventListener('click', () => movePhoto(areaId, filename, target.id));
                footer.appendChild(move);
            }

            card.append(img, remove, footer);
            grid.appendChild(card);
        }
    }

    async function refresh() {
        try {
            const response = await fetch('/api/admin/backgrounds', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const photos = await response.json();
            for (const area of AREAS) {
                renderArea(area.id, Array.isArray(photos[area.id]) ? photos[area.id] : []);
            }
        } catch (error) {
            for (const area of AREAS) {
                setStatus(area.id, `一覧の取得に失敗しました: ${error.message}`, true);
            }
        }
    }

    async function uploadPhotos(areaId, files) {
        const button = sections.get(areaId).querySelector('[data-upload]');
        const formData = new FormData();
        for (const file of files) {
            formData.append('photos', file);
        }

        button.disabled = true;
        setStatus(areaId, `${files.length}枚アップロード中…`);

        try {
            const response = await fetch(`/api/admin/backgrounds/${areaId}`, {
                method: 'POST',
                headers: { 'X-Requested-With': 'fetch' },
                body: formData
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok && !(result.saved && result.saved.length > 0)) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            const failedNote = result.failed && result.failed.length > 0
                ? `（失敗: ${result.failed.map((f) => f.name).join(', ')}）`
                : '';
            setStatus(areaId, `${result.saved.length}枚追加しました${failedNote}`, Boolean(failedNote));
        } catch (error) {
            setStatus(areaId, `アップロードに失敗しました: ${error.message}`, true);
        } finally {
            button.disabled = false;
            refresh();
        }
    }

    async function movePhoto(areaId, filename, destination) {
        try {
            const response = await fetch(`/api/admin/backgrounds/${areaId}/${encodeURIComponent(filename)}/move`, {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'fetch',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ to: destination })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            setStatus(destination, `${filename} を移動しました`);
        } catch (error) {
            setStatus(areaId, `移動に失敗しました: ${error.message}`, true);
        } finally {
            refresh();
        }
    }

    async function deletePhoto(areaId, filename) {
        if (!window.confirm(`${filename} を削除しますか？`)) return;

        try {
            const response = await fetch(`/api/admin/backgrounds/${areaId}/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers: { 'X-Requested-With': 'fetch' }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            setStatus(areaId, `${filename} を削除しました`);
        } catch (error) {
            setStatus(areaId, `削除に失敗しました: ${error.message}`, true);
        } finally {
            refresh();
        }
    }

    for (const area of AREAS) {
        buildAreaSection(area);
    }
    refresh();
})();
