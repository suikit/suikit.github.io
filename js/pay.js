// Sui Kit — checkout frontend.
// Connect a Sui wallet, pay PRICE_USDC to the seller, hand the buyer a
// verifiable tx digest. Repo invite is completed manually (or by the future
// backend endpoint) — see the note in the modal footer.

import { SuiClient } from 'https://esm.sh/@mysten/sui@2.37.0/client';
import { Transaction } from 'https://esm.sh/@mysten/sui@2.37.0/transactions';
import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.19.0';

// ---- Config ---------------------------------------------------------------
// TODO: replace with the seller's Sui address that should receive the USDC.
const SELLER_ADDRESS = '0xREPLACE_WITH_SELLER_ADDRESS';
const PRICE_USDC = 100;                     // display units
const USDC_DECIMALS = 6;
const USDC_TYPE =
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const CHAIN = 'sui:mainnet';
const RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const TELEGRAM_URL = 'https://t.me/YOUR_TELEGRAM_HANDLE';
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
        tgText: (d) => `Sui kit purchase — digest: ${d} — GitHub user:  — email (optional): `,
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
        tgText: (d) => `Compra do Sui kit — digest: ${d} — usuário GitHub:  — e-mail (opcional): `,
    },
}[LANG];

const client = new SuiClient({ url: RPC_URL });

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
    } catch (e) {
        fail(e?.message || I18N.connectCancelled);
    }
}

async function pay() {
    if (SELLER_ADDRESS.includes('REPLACE')) {
        return fail(I18N.noSeller);
    }
    const btn = $('pay-btn');
    btn.disabled = true;
    btn.textContent = I18N.waiting;
    try {
        const owner = account.address;
        const amount = BigInt(PRICE_USDC) * 10n ** BigInt(USDC_DECIMALS);

        const { data: coins } = await client.getCoins({ owner, coinType: USDC_TYPE });
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

        try { await client.waitForTransaction({ digest }); } catch { /* show digest anyway */ }

        $('pay-digest').textContent = digest;
        $('suiscan-link').href = `https://suiscan.xyz/mainnet/tx/${digest}`;
        const tg = $('tg-final-link');
        tg.href = `${TELEGRAM_URL}?text=${encodeURIComponent(I18N.tgText(digest))}`;
        show('done');
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

function disconnect() {
    try { wallet?.features['standard:disconnect']?.disconnect(); } catch {}
    wallet = null;
    account = null;
    updateNavConnect();
}

export function initCheckout() {
    $('nav-connect').addEventListener('click', () => {
        if (account) { disconnect(); return; }
        modal.classList.add('open');
        show('wallets');
        renderWalletList();
    });
    document.querySelectorAll('[data-open-pay]').forEach((el) =>
        el.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.add('open');
            if (account) {
                show('pay');
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
