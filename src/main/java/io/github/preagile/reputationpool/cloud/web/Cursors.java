package io.github.preagile.reputationpool.cloud.web;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Encodes/decodes the audit-event keyset cursor (issue #30) at the HTTP boundary. Internally a cursor
 * is just a {@code seq} (the ledger's IDENTITY primary key), but the wire form is deliberately
 * <b>opaque</b>: a URL-safe Base64 string rather than a bare number. That keeps the pagination token an
 * implementation detail — clients round-trip {@code nextCursor} verbatim instead of doing arithmetic on
 * a raw {@code seq} — so the encoding can evolve without a breaking API change.
 *
 * <p>{@link #decode(String)} rejects anything that is not a well-formed encoding of a non-negative
 * {@code long} by throwing {@link IllegalArgumentException}; the controller translates that into a 400.
 */
final class Cursors {

    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    /**
     * Upper bound on the wire token length. A {@code long}'s Base64 form is ~13 chars, so 100 is
     * generous headroom while making {@link #decode(String)} self-defensive: it rejects absurd input
     * before allocating, independent of the servlet container's own request-line limit.
     */
    private static final int MAX_CURSOR_LENGTH = 100;

    private Cursors() {}

    /** Opaque, URL-safe token for a {@code seq}. */
    static String encode(long seq) {
        return ENCODER.encodeToString(Long.toString(seq).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Decodes a token produced by {@link #encode(long)} back to its {@code seq}.
     *
     * @throws IllegalArgumentException if the token is not valid URL-safe Base64 of a non-negative long
     */
    static long decode(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            throw new IllegalArgumentException("cursor must not be blank");
        }
        if (cursor.length() > MAX_CURSOR_LENGTH) {
            throw new IllegalArgumentException("cursor is too long");
        }
        final byte[] decoded;
        try {
            decoded = DECODER.decode(cursor);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("malformed cursor", e);
        }
        final long seq;
        try {
            seq = Long.parseLong(new String(decoded, StandardCharsets.UTF_8));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("malformed cursor", e);
        }
        if (seq < 0) {
            throw new IllegalArgumentException("cursor must not be negative");
        }
        return seq;
    }
}
