(() => {
    'use strict';

    const SLOTS = [
        { id: 'morning', label: '朝 (morning)' },
        { id: 'lunch', label: '昼 (lunch)' },
        { id: 'night', label: '夜 (night)' }
    ];

    const slotsRoot = document.querySelector('[data-slots]');
    const sections = new Map();

    function buildSlotSection(slot) {
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
        section.querySelector('h2').textContent = slot.label;

        const fileInput = section.querySelector('[data-file-input]');
        const uploadButton = section.querySelector('[data-upload]');

        uploadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadPhotos(slot.id, fileInput.files);
                fileInput.value = '';
            }
        });

        slotsRoot.appendChild(section);
        sections.set(slot.id, section);
    }

    function setStatus(slotId, message, isError = false) {
        const status = sections.get(slotId).querySelector('[data-status]');
        status.textContent = message;
        status.style.color = isError ? '#ff9a9a' : '';
    }

    function renderSlot(slotId, photos) {
        const section = sections.get(slotId);
        const grid = section.querySelector('[data-grid]');
        section.querySelector('[data-count]').textContent = `${photos.length} photos`;
        grid.replaceChildren();

        if (photos.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'photo-empty';
            empty.textContent = 'まだ写真がありません。';
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
            remove.addEventListener('click', () => deletePhoto(slotId, filename));

            card.append(img, remove);
            grid.appendChild(card);
        }
    }

    async function refresh() {
        try {
            const response = await fetch('/api/backgrounds', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const photos = await response.json();
            for (const slot of SLOTS) {
                renderSlot(slot.id, Array.isArray(photos[slot.id]) ? photos[slot.id] : []);
            }
        } catch (error) {
            for (const slot of SLOTS) {
                setStatus(slot.id, `一覧の取得に失敗しました: ${error.message}`, true);
            }
        }
    }

    async function uploadPhotos(slotId, files) {
        const button = sections.get(slotId).querySelector('[data-upload]');
        const formData = new FormData();
        for (const file of files) {
            formData.append('photos', file);
        }

        button.disabled = true;
        setStatus(slotId, `${files.length}枚アップロード中…`);

        try {
            const response = await fetch(`/api/admin/backgrounds/${slotId}`, {
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
            setStatus(slotId, `${result.saved.length}枚追加しました${failedNote}`, Boolean(failedNote));
        } catch (error) {
            setStatus(slotId, `アップロードに失敗しました: ${error.message}`, true);
        } finally {
            button.disabled = false;
            refresh();
        }
    }

    async function deletePhoto(slotId, filename) {
        if (!window.confirm(`${filename} を削除しますか？`)) return;

        try {
            const response = await fetch(`/api/admin/backgrounds/${slotId}/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers: { 'X-Requested-With': 'fetch' }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            setStatus(slotId, `${filename} を削除しました`);
        } catch (error) {
            setStatus(slotId, `削除に失敗しました: ${error.message}`, true);
        } finally {
            refresh();
        }
    }

    for (const slot of SLOTS) {
        buildSlotSection(slot);
    }
    refresh();
})();
