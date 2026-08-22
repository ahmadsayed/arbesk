/**
 * Shared dialog-host fixture for jsdom tests.
 *
 * Post-Alpine-migration, `ui/dialog.ts` requires a persistent #appDialogHost
 * element in the DOM and renders asynchronously. Any test that triggers
 * showDialog/showConfirmDialog/... must include this fragment in its
 * document.body fixture BEFORE Alpine processes the DOM, and must flush a
 * macrotask tick (Alpine's MutationObserver + queueMicrotask scheduler)
 * before asserting on dialog DOM.
 *
 * The fragment mirrors frontend/src/pug/includes/dialog-host.pug
 * byte-for-byte in directives/classes (the E2E + unit DOM contract).
 */

export const DIALOG_HOST_FRAGMENT = `
<div id="appDialogHost" x-data="dialog">
  <template x-if="open">
    <div class="dialog-backdrop" @click.self="cancel()">
      <div class="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="dialog-header"><h2 class="dialog-title" :id="titleId" x-text="title"></h2></div>
        <template x-if="kind === 'prompt'">
          <div class="dialog-body">
            <p style="margin:0 0 var(--size-2)" x-text="body"></p>
            <div class="form-group"><input class="dialog-input form-input" type="text" autocomplete="off" :value="inputValue" @keydown.enter.prevent="confirm()" @keydown.escape.prevent="cancel()"></div>
          </div>
        </template>
        <template x-if="kind === 'confirm'">
          <div class="dialog-body"><p style="margin:0" x-text="body"></p></div>
        </template>
        <template x-if="kind === 'info'">
          <div class="dialog-body" x-html="bodyHtml"></div>
        </template>
        <template x-if="kind === 'checkbox'">
          <div class="dialog-body">
            <p style="margin:0 0 var(--size-2)" x-text="body"></p>
            <template x-for="(opt, idx) in options" :key="idx">
              <label style="display:flex;align-items:center;gap:var(--size-2);padding:var(--size-1) 0">
                <input type="checkbox" :value="opt.value" :checked="opt.checked" @change="onOptionToggle(opt, $event)">
                <span x-text="opt.label"></span>
              </label>
            </template>
          </div>
        </template>
        <template x-if="kind === 'custom'">
          <div class="dialog-body collaborator-dialog-body"><div id="appDialogCustomBody"></div></div>
        </template>
        <template x-if="kind === 'burn'">
          <div class="dialog-body">
            <p class="dialog-warning" style="margin:0 0 var(--size-2)">Burning collection will delete all assets unless it is part of besked collection</p>
            <p style="margin:0 0 var(--size-2)">Type <strong x-text="collectionName"></strong> to confirm.</p>
            <div class="form-group"><input class="dialog-input form-input" type="text" autocomplete="off" :placeholder="placeholder" @input="onBurnInput($event.target.value)" @keydown.escape.prevent="cancel()" @keydown.enter="onBurnEnter($event)"></div>
          </div>
        </template>
        <template x-if="kind === 'prompt'">
          <div class="dialog-actions">
            <button class="btn btn-secondary dialog-cancel-btn" type="button" @click="cancel()">Cancel</button>
            <button class="btn btn-primary dialog-confirm-btn" type="button" @click="confirm()">Confirm</button>
          </div>
        </template>
        <template x-if="kind === 'confirm'">
          <div class="dialog-actions">
            <template x-for="(btn, idx) in buttons" :key="idx"><button class="dialog-action-btn" type="button" :class="btn.className" :data-value="btn.value" x-text="btn.text" @click="closeWithValue(btn.value)"></button></template>
          </div>
        </template>
        <template x-if="kind === 'info' || kind === 'custom'">
          <div class="dialog-actions"><button class="btn btn-primary dialog-close-btn" type="button" @click="cancel()">Close</button></div>
        </template>
        <template x-if="kind === 'checkbox'">
          <div class="dialog-actions">
            <button class="btn btn-secondary dialog-action-btn" type="button" data-value="cancel" @click="cancel()">Cancel</button>
            <button class="btn btn-primary dialog-confirm-btn" type="button" @click="confirmCheckbox()">Confirm</button>
          </div>
        </template>
        <template x-if="kind === 'burn'">
          <div class="dialog-actions">
            <button class="btn btn-secondary dialog-cancel-btn" type="button" @click="cancel()">Cancel</button>
            <button class="btn btn-danger dialog-burn-btn" type="button" :disabled="!burnEnabled" @click="closeWithValue('burn')">Burn Collection</button>
          </div>
        </template>
      </div>
    </div>
  </template>
</div>`;

/**
 * Let Alpine's MutationObserver + queueMicrotask scheduler process pending
 * DOM changes (real-timers variant; dialog.test.js uses fake timers and its
 * own flush()). Two macrotask ticks: one for the observer/init, one for the
 * x-if render effect.
 */
export async function flushDialog() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
