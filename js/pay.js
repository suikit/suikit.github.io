// Sui Kit — checkout frontend.
// Connect a Sui wallet, pay PRICE_USDC to the seller, hand the buyer a
// verifiable tx digest. Repo invite is completed manually (or by the future
// backend endpoint) — see the note in the modal footer.

import { Transaction } from 'https://esm.sh/@mysten/sui@3.0.1/transactions';
import { getWallets } from 'https://esm.sh/@wallet-standard/app@1.1.1';

// ---- Config ---------------------------------------------------------------
const SELLER_ADDRESS = '0x2e1e0fcc8cfe489fd268ab170161684480c2b0152f849a6c54fa1690dffeea97';
const PRICE_USDC = 100;                     // display units
const USDC_DECIMALS = 6;
const USDC_TYPE =
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const CHAIN = 'sui:mainnet';
const RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const TELEGRAM_URL = 'https://t.me/sui_kit_bot';
// ---------------------------------------------------------------------------

const LANG = (document.documentElement.lang || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en';
const I18N = {
    en: {
        noWallet1: 'No Sui wallet detected in this browser.',
        noWallet2: 'then reopen this dialog.',
        waiting: 'Waiting for wallet…',
        copied: 'copied', copy: 'copy',
        noAccounts: 'No Sui account found in the wallet.',
        connectCancelled: 'Wallet connection was cancelled.',
        noSeller: 'Seller address is not configured yet.',
        insufficient: (need, have) => `Insufficient USDC — need ${need} USDC, wallet has ${have}.`,
        noSign: (w) => `${w} does not support transaction signing.`,
        noDigest: 'Transaction signed but no digest returned.',
        payFailed: 'Payment failed or was rejected.',
        payBtn: `Pay $${100} USDC`,
    },
    pt: {
        noWallet1: 'Nenhuma carteira Sui detectada neste navegador.',
        noWallet2: 'depois reabra esta janela.',
        waiting: 'Aguardando a carteira…',
        copied: 'copiado', copy: 'copiar',
        noAccounts: 'Nenhuma conta Sui encontrada na carteira.',
        connectCancelled: 'Conexão com a carteira cancelada.',
        noSeller: 'Endereço do vendedor ainda não configurado.',
        insufficient: (need, have) => `USDC insuficiente — precisa de ${need} USDC, a carteira tem ${have}.`,
        noSign: (w) => `${w} não suporta assinatura de transações.`,
        noDigest: 'Transação assinada, mas nenhum digest retornado.',
        payFailed: 'Pagamento falhou ou foi rejeitado.',
        payBtn: 'Pagar $100 USDC',
    },
}[LANG];

// Minimal JSON-RPC helper — SDK v3 dropped JSON-RPC support, but the public
// fullnode endpoint still serves it and it is all we need for reads.
async function rpc(method, params) {
    const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
}

async function getAllUsdcCoins(owner) {
    const coins = [];
    let cursor = null;
    do {
        const page = await rpc('suix_getCoins', [owner, USDC_TYPE, cursor, 50]);
        coins.push(...(page?.data || []));
        cursor = page?.hasNextPage ? page.nextCursor : null;
    } while (cursor);
    return coins;
}

async function waitForTx(digest, tries = 8) {
    for (let i = 0; i < tries; i++) {
        try {
            const tx = await rpc('sui_getTransactionBlock', [digest, { showEffects: true }]);
            if (tx) return tx;
        } catch { /* not indexed yet */ }
        await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
}

function normAddr(addr) {
    try { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); } catch { return ''; }
}

// Did this wallet already pay? Scan buyer->seller txs for a >=PRICE_USDC
// USDC credit to SELLER_ADDRESS and return the digest (or null).
async function findPayment(owner) {
    const need = BigInt(PRICE_USDC) * 10n ** BigInt(USDC_DECIMALS);
    const seller = normAddr(SELLER_ADDRESS);
    const match = (t) => (t.balanceChanges || []).some((c) =>
        normAddr(c.owner?.AddressOwner) === seller &&
        c.coinType === USDC_TYPE && BigInt(c.amount) >= need);
    for (const filter of [
        { FromAndToAddress: { from: owner, to: SELLER_ADDRESS } },
        { FromAddress: owner },
    ]) {
        let cursor = null, pages = 0;
        try {
            do {
                const res = await rpc('suix_queryTransactionBlocks', [{
                    filter,
                    options: { showBalanceChanges: true },
                    order: 'descending', limit: 50, cursor,
                }]);
                const hit = (res?.data || []).find(match);
                if (hit) return hit.digest;
                cursor = res?.hasNextPage ? res.nextCursor : null;
            } while (cursor && ++pages < 10);
            return null;      // filter worked, nothing found
        } catch { /* filter unsupported — try next */ }
    }
    return null;
}

const $ = (id) => document.getElementById(id);
const modal = $('pay-modal');
const steps = {
    wallets: $('pay-step-wallets'),
    pay: $('pay-step-pay'),
    done: $('pay-step-done'),
    error: $('pay-step-error'),
};

let wallet = null;
let account = null;
let paidDigest = null;

function rememberPaid(addr, digest) {
    try { localStorage.setItem('suikit-paid', JSON.stringify({ addr, digest })); } catch {}
}

function showDone(digest) {
    $('pay-digest').textContent = digest;
    $('suiscan-link').href = `https://suiscan.xyz/mainnet/tx/${digest}`;
    $('tg-final-link').href = `${TELEGRAM_URL}?start=${digest}`;
    show('done');
}

// After connect, check on-chain whether this address already paid and jump
// straight to the "paid" screen so buyers can resume the invite flow.
async function detectPriorPayment() {
    const acc = account;
    if (!acc || paidDigest) return;
    try {
        const cached = JSON.parse(localStorage.getItem('suikit-paid') || 'null');
        if (normAddr(cached?.addr) === normAddr(acc.address) && cached?.digest) {
            paidDigest = cached.digest;
            return showDone(paidDigest);
        }
    } catch {}
    const d = await findPayment(acc.address).catch(() => null);
    if (d && account === acc) {
        paidDigest = d;
        rememberPaid(acc.address, d);
        showDone(d);
    }
}

function show(step) {
    Object.values(steps).forEach((el) => el.classList.add('hidden'));
    steps[step].classList.remove('hidden');
}

function short(addr) {
    return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

function fail(msg) {
    $('pay-error-msg').textContent = msg;
    show('error');
}

async function renderWalletList() {
    const list = $('wallet-list');
    list.innerHTML = '';
    const registry = getWallets();
    const found = registry.get();
    if (!found.length) {
        list.innerHTML = `
            <p class="muted">${I18N.noWallet1}</p>
            <p class="muted">Install <a href="https://slush.app" target="_blank" rel="noopener">Slush</a>
            or <a href="https://suiwallet.com" target="_blank" rel="noopener">Sui Wallet</a>, ${I18N.noWallet2}</p>`;
        return;
    }
    for (const w of found) {
        const btn = document.createElement('button');
        btn.className = 'wallet-btn';
        btn.innerHTML = `${w.icon ? `<img src="${w.icon}" alt="">` : ''}<span>${w.name}</span>`;
        btn.onclick = () => connect(w);
        list.appendChild(btn);
    }
    registry.on('register', () => renderWalletList());
}

async function connect(w) {
    try {
        if (!w.features['standard:connect']) return fail(`${w.name} cannot connect.`);
        const res = await w.features['standard:connect'].connect();
        const acc = res.accounts.find((a) => a.chains?.includes(CHAIN)) || res.accounts[0];
        if (!acc) return fail(I18N.noAccounts);
        wallet = w;
        account = acc;
        $('pay-account').textContent = short(account.address);
        $('pay-account').title = account.address;
        updateNavConnect();
        show('pay');
        detectPriorPayment();
    } catch (e) {
        fail(e?.message || I18N.connectCancelled);
    }
}

async function pay() {
    if (paidDigest) return showDone(paidDigest);
    if (SELLER_ADDRESS.includes('REPLACE')) {
        return fail(I18N.noSeller);
    }
    const btn = $('pay-btn');
    btn.disabled = true;
    btn.textContent = I18N.waiting;
    try {
        const owner = account.address;
        const amount = BigInt(PRICE_USDC) * 10n ** BigInt(USDC_DECIMALS);

        const coins = await getAllUsdcCoins(owner);
        const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
        if (total < amount) {
            throw new Error(I18N.insufficient(PRICE_USDC, (Number(total) / 10 ** USDC_DECIMALS).toFixed(2)));
        }

        const tx = new Transaction();
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) {
            tx.mergeCoins(primary, coins.slice(1).map((c) => tx.object(c.coinObjectId)));
        }
        const [payment] = tx.splitCoins(primary, [amount]);
        tx.transferObjects([payment], SELLER_ADDRESS);
        tx.setSender(owner);
        tx.setGasBudget(10_000_000);

        const feature = wallet.features['sui:signAndExecuteTransaction'];
        if (!feature) throw new Error(I18N.noSign(wallet.name));
        const result = await feature.signAndExecuteTransaction({
            transaction: tx,
            account,
            chain: CHAIN,
        });
        const digest = result?.digest || result?.effects?.transactionDigest;
        if (!digest) throw new Error(I18N.noDigest);

        try { await waitForTx(digest); } catch { /* show digest anyway */ }

        paidDigest = digest;
        rememberPaid(account.address, digest);
        showDone(digest);
    } catch (e) {
        fail(e?.message || I18N.payFailed);
    } finally {
        btn.disabled = false;
        btn.textContent = I18N.payBtn;
    }
}

function copyDigest() {
    const text = $('pay-digest').textContent;
    navigator.clipboard?.writeText(text).then(() => {
        const b = $('copy-digest');
        b.textContent = I18N.copied;
        setTimeout(() => (b.textContent = I18N.copy), 1500);
    });
}

function updateNavConnect() {
    const btn = $('nav-connect');
    if (btn) {
        if (account) {
            btn.textContent = short(account.address);
            btn.title = `${account.address} — click to disconnect`;
            btn.classList.add('connected');
        } else {
            btn.textContent = 'Connect';
            btn.title = 'Connect a Sui wallet';
            btn.classList.remove('connected');
        }
    }
    const acct = $('pay-acct');
    if (acct) {
        acct.hidden = !account;
        if (account) $('pay-acct-addr').textContent = account.address;
    }
}

function disconnect() {
    try { wallet?.features['standard:disconnect']?.disconnect(); } catch {}
    wallet = null;
    account = null;
    paidDigest = null;
    updateNavConnect();
}

export function initCheckout() {
    $('nav-connect')?.addEventListener('click', () => {
        if (account) { disconnect(); return; }
        modal.classList.add('open');
        show('wallets');
        renderWalletList();
    });
    $('pay-disconnect')?.addEventListener('click', () => {
        disconnect();
        show('wallets');
        renderWalletList();
    });
    document.querySelectorAll('[data-open-pay]').forEach((el) =>
        el.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.add('open');
            if (account) {
                paidDigest ? showDone(paidDigest) : show('pay');
            } else {
                show('wallets');
                renderWalletList();
            }
        })
    );
    $('pay-close').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
    });
    $('pay-btn').addEventListener('click', pay);
    $('pay-back').addEventListener('click', () => show('wallets'));
    $('pay-retry').addEventListener('click', () => show(account ? 'pay' : 'wallets'));
    $('copy-digest').addEventListener('click', copyDigest);
}
