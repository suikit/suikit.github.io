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
const GQL_URL = 'https://graphql.mainnet.sui.io/graphql';
const TELEGRAM_URL = 'https://t.me/sui_kit_bot';
// ---------------------------------------------------------------------------

const _lang = (document.documentElement.lang || 'en').toLowerCase();
const LANG = _lang.startsWith('pt') ? 'pt' : _lang.startsWith('ko') ? 'ko' : 'en';
const I18N = {
    ko: {
        noWallet1: '이 브라우저에서 Sui 월렛이 감지되지 않았습니다.',
        noWallet2: '설치 후 이 창을 다시 여세요.',
        noWalletMobile: '모바일에서는 월렛 앱(Slush / Trust Wallet)의 내장 브라우저에서 이 페이지를 여세요.',
        manualPay: '또는 직접 결제하세요 — 아래 주소로 <b>100 USDC</b>(Sui 메인넷)를 전송:',
        manualAfter: '전송 후 월렛 앱의 트랜잭션 내역에서 digest(트랜잭션 해시)를 복사해',
        copyAddr: '주소 복사',
        waiting: '월렛을 기다리는 중…',
        copied: '복사됨', copy: '복사',
        noAccounts: '월렛에서 Sui 계정을 찾지 못했습니다.',
        connectCancelled: '월렛 연결이 취소되었습니다.',
        noSeller: '판매자 주소가 아직 설정되지 않았습니다.',
        insufficient: (need, have) => `USDC 부족 — ${need} USDC 필요, 월렛 잔액 ${have}.`,
        noSign: (w) => `${w}은(는) 트랜잭션 서명을 지원하지 않습니다.`,
        noDigest: '트랜잭션은 서명됐지만 digest가 반환되지 않았습니다.',
        payFailed: '결제가 실패했거나 거부되었습니다.',
        payBtn: '$100 USDC 결제',
    },
    en: {
        noWallet1: 'No Sui wallet detected in this browser.',
        noWallet2: 'then reopen this dialog.',
        noWalletMobile: 'On mobile, open this page inside your wallet app’s browser (Slush / Trust Wallet).',
        manualPay: 'Or pay manually — send <b>100 USDC</b> (Sui mainnet) to:',
        manualAfter: 'After sending, copy the transaction digest from your wallet’s history and send it to',
        copyAddr: 'copy address',
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
        noWalletMobile: 'No celular, abra esta página no navegador interno do app da carteira (Slush / Trust Wallet).',
        manualPay: 'Ou pague manualmente — envie <b>100 USDC</b> (Sui mainnet) para:',
        manualAfter: 'Depois de enviar, copie o digest da transação no histórico da carteira e envie para',
        copyAddr: 'copiar endereço',
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

// GraphQL helper — the public JSON-RPC fullnode endpoint was deprecated,
// so all chain reads go through the Sui GraphQL service.
async function gql(query) {
    const res = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'query failed');
    return json.data;
}

// Object type filter for USDC coins — the GraphQL schema wants the
// fully-padded package id ("0x0000…02", not "0x2").
const SUI_FRAMEWORK = '0x0000000000000000000000000000000000000000000000000000000000000002';
const USDC_COIN_TYPE = `${SUI_FRAMEWORK}::coin::Coin<${USDC_TYPE}>`;

async function getAllUsdcCoins(owner) {
    const coins = [];
    let cursor = null;
    do {
        const data = await gql(`{
            objects(filter: { owner: "${owner}", type: "${USDC_COIN_TYPE}" }, first: 50${cursor ? `, after: "${cursor}"` : ''}) {
                nodes { address asMoveObject { contents { json } } }
                pageInfo { hasNextPage endCursor }
            }
        }`);
        const conn = data?.objects;
        for (const n of conn?.nodes || []) {
            coins.push({ coinObjectId: n.address, balance: n.asMoveObject?.contents?.json?.balance ?? '0' });
        }
        cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (cursor);
    return coins;
}

async function waitForTx(digest, tries = 8) {
    for (let i = 0; i < tries; i++) {
        try {
            const data = await gql(`{ transaction(digest: "${digest}") { digest } }`);
            if (data?.transaction) return data.transaction;
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
    const match = (t) => (t.effects?.balanceChanges?.nodes || []).some((c) =>
        normAddr(c.owner?.address || '') === seller &&
        c.coinType?.repr === USDC_TYPE && BigInt(c.amount) >= need);
    for (const filter of [
        `sentAddress: "${owner}", affectedAddress: "${SELLER_ADDRESS}"`,
        `sentAddress: "${owner}"`,
    ]) {
        let cursor = null, pages = 0;
        try {
            do {
                const data = await gql(`{
                    transactions(filter: { ${filter} }, first: 50${cursor ? `, after: "${cursor}"` : ''}) {
                        nodes {
                            digest
                            effects { balanceChanges { nodes { owner { address } coinType { repr } amount } } }
                        }
                        pageInfo { hasNextPage endCursor }
                    }
                }`);
                const conn = data?.transactions;
                const hit = (conn?.nodes || []).find(match);
                if (hit) return hit.digest;
                cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
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

// Keep only wallets that can actually sign Sui transactions: a sui:* feature
// or a known Sui-capable name. Also dedupe by display name (some extensions
// register twice under the standard).
const SUI_WALLET_NAMES = /slush|sui wallet|suiet|nightly|trust|backpack|martian|surf|okx|onekey|bitget|phantom|glass|morphis|elli|tokenpocket/i;
function usableSuiWallets() {
    const seen = new Set();
    return getWallets().get().filter((w) => {
        const ok = Object.keys(w.features).some((f) => f.startsWith('sui:'))
            || SUI_WALLET_NAMES.test(w.name);
        if (!ok || seen.has(w.name)) return false;
        seen.add(w.name);
        return true;
    });
}

async function renderWalletList() {
    const list = $('wallet-list');
    list.innerHTML = '';
    const registry = getWallets();
    const found = usableSuiWallets();
    if (!found.length) {
        const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        if (!mobile) {
            list.innerHTML = `<p class="muted">${I18N.noWallet1}</p>
            <p class="muted">Install <a href="https://slush.app" target="_blank" rel="noopener">Slush</a>
            or <a href="https://suiwallet.com" target="_blank" rel="noopener">Sui Wallet</a>, ${I18N.noWallet2}</p>`;
            return;
        }
        list.innerHTML = `<p class="muted">${I18N.noWallet1} ${I18N.noWalletMobile}</p>
        <p class="muted">${I18N.manualPay}</p>
        <p class="digest mono">${SELLER_ADDRESS}</p>
        <div class="digest-actions">
            <button class="link-btn" id="copy-seller">${I18N.copyAddr}</button>
        </div>
        <p class="muted small">${I18N.manualAfter}
        <a href="${TELEGRAM_URL}" target="_blank" rel="noopener">@sui_kit_bot</a>.</p>`;
        const b = $('copy-seller');
        b.onclick = () => navigator.clipboard?.writeText(SELLER_ADDRESS).then(() => {
            b.textContent = I18N.copied;
            setTimeout(() => (b.textContent = I18N.copyAddr), 1500);
        });
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
        updateAccountDisplay();
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

function updateAccountDisplay() {
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
    updateAccountDisplay();
}

export function initCheckout() {
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
