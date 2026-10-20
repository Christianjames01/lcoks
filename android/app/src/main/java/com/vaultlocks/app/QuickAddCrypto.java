package com.vaultlocks.app;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypts one quick-add entry to the vault's inbox public key, byte-for-byte the
 * same format as src/core/inbox.ts (which decrypts it on the next unlock):
 *
 *   ephemeral ECDH P-256 → HKDF-SHA256(salt = ephemeral public key, info) → AES-256-GCM(aad = info)
 *
 * Only the public key is ever available here, so nothing can be decrypted on this side.
 * Plain Java (no Android APIs) so it can be checked against the JS implementation on a desktop JVM.
 */
public final class QuickAddCrypto {
    public static final String INFO = "VaultLocks inbox v1";

    public static final class Sealed {
        public final byte[] epk;
        public final byte[] iv;
        public final byte[] ct;

        Sealed(byte[] epk, byte[] iv, byte[] ct) {
            this.epk = epk;
            this.iv = iv;
            this.ct = ct;
        }
    }

    private QuickAddCrypto() {}

    /** pubRaw: 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y). */
    public static Sealed seal(byte[] pubRaw, byte[] plaintext) throws Exception {
        if (pubRaw == null || pubRaw.length != 65 || pubRaw[0] != 4) throw new IllegalArgumentException("bad inbox key");
        AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
        params.init(new ECGenParameterSpec("secp256r1"));
        ECParameterSpec spec = params.getParameterSpec(ECParameterSpec.class);
        ECPoint w = new ECPoint(new BigInteger(1, Arrays.copyOfRange(pubRaw, 1, 33)), new BigInteger(1, Arrays.copyOfRange(pubRaw, 33, 65)));
        PublicKey recipient = KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(w, spec));

        KeyPairGenerator gen = KeyPairGenerator.getInstance("EC");
        gen.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        KeyPair eph = gen.generateKeyPair();
        byte[] epk = rawPoint((ECPublicKey) eph.getPublic());

        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(eph.getPrivate());
        ka.doPhase(recipient, true);
        byte[] shared = ka.generateSecret();

        byte[] info = INFO.getBytes(StandardCharsets.UTF_8);
        byte[] key = hkdf(shared, epk, info);
        Arrays.fill(shared, (byte) 0);

        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        c.updateAAD(info);
        byte[] ct = c.doFinal(plaintext);
        Arrays.fill(key, (byte) 0);
        return new Sealed(epk, iv, ct);
    }

    /** RFC 5869 HKDF-SHA256, 32-byte output. */
    static byte[] hkdf(byte[] ikm, byte[] salt, byte[] info) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 1);
        byte[] okm = mac.doFinal();
        Arrays.fill(prk, (byte) 0);
        return Arrays.copyOf(okm, 32);
    }

    static byte[] rawPoint(ECPublicKey k) {
        byte[] out = new byte[65];
        out[0] = 4;
        put32(k.getW().getAffineX(), out, 1);
        put32(k.getW().getAffineY(), out, 33);
        return out;
    }

    private static void put32(BigInteger v, byte[] out, int off) {
        byte[] b = v.toByteArray();
        int len = Math.min(b.length, 32);
        System.arraycopy(b, b.length - len, out, off + 32 - len, len);
    }
}
