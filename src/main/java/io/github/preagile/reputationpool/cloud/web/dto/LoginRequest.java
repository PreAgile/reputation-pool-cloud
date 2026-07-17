package io.github.preagile.reputationpool.cloud.web.dto;

/** Admin login body: the credentials exchanged for a control-plane JWT. */
public record LoginRequest(String username, String password) {}
