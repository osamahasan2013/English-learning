import { describe, expect, it } from "vitest";
import { anonClient, PASSWORD, registerParent, serviceClient, uniqueEmail } from "./helpers";

describe("parent authentication (Supabase Auth + profile trigger)", () => {
  it("registration creates a session and a parent profile with the browser's time zone", async () => {
    const { client, userId } = await registerParent("  Amira  ", "Asia/Dubai");
    const { data: profile, error } = await client.from("profiles").select("*").eq("id", userId).single();
    expect(error).toBeNull();
    expect(profile).toMatchObject({
      id: userId,
      display_name: "Amira",
      role: "parent",
      timezone: "Asia/Dubai",
    });
  });

  it("an invalid time zone at sign-up falls back to UTC", async () => {
    const { client, userId } = await registerParent("Kim", "Mars/Olympus");
    const { data } = await client.from("profiles").select("timezone").eq("id", userId).single();
    expect(data?.timezone).toBe("UTC");
  });

  it("registering an existing email fails", async () => {
    const { email } = await registerParent();
    const { error } = await anonClient().auth.signUp({ email, password: PASSWORD });
    expect(error?.code).toBe("user_already_exists");
  });

  it("logs in with the right password and not with a wrong one", async () => {
    const { email, userId } = await registerParent();
    const good = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
    expect(good.error).toBeNull();
    expect(good.data.user?.id).toBe(userId);

    const bad = await anonClient().auth.signInWithPassword({ email, password: "wrong-password" });
    expect(bad.error?.code).toBe("invalid_credentials");
    expect(bad.data.session).toBeNull();
  });

  it("logging out revokes the refresh token", async () => {
    const { email } = await registerParent();
    const client = anonClient();
    const { data } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    const refreshToken = data.session!.refresh_token;

    expect((await client.auth.signOut()).error).toBeNull();
    const reuse = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    expect(reuse.error).not.toBeNull();
    expect(reuse.data.session).toBeNull();
  });

  it("password recovery links sign the parent in so they can set a new password", async () => {
    const { email } = await registerParent();
    const { data: link, error } = await serviceClient().auth.admin.generateLink({ type: "recovery", email });
    expect(error).toBeNull();

    const client = anonClient();
    const verified = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: link.properties!.hashed_token,
    });
    expect(verified.error).toBeNull();
    expect((await client.auth.updateUser({ password: "a-brand-new-password" })).error).toBeNull();

    expect((await anonClient().auth.signInWithPassword({ email, password: PASSWORD })).error).not.toBeNull();
    expect(
      (await anonClient().auth.signInWithPassword({ email, password: "a-brand-new-password" })).error,
    ).toBeNull();
  });

  it("signed-out visitors cannot read any data", async () => {
    const anon = anonClient();
    const levels = await anon.from("levels").select("id");
    const children = await anon.from("children").select("id");
    expect(levels.error?.code).toBe("42501");
    expect(children.error?.code).toBe("42501");
  });

  it("uses unique emails per run", () => {
    expect(uniqueEmail("a")).not.toBe(uniqueEmail("a"));
  });
});

describe("parent profile", () => {
  it("a parent updates their own name and time zone, and an invalid time zone is rejected", async () => {
    const { client, userId } = await registerParent("Before");
    const ok = await client
      .from("profiles")
      .update({ display_name: "After", timezone: "America/New_York" })
      .eq("id", userId)
      .select("display_name, timezone")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual({ display_name: "After", timezone: "America/New_York" });

    const bad = await client.from("profiles").update({ timezone: "Mars/Base" }).eq("id", userId);
    expect(bad.error?.message).toBe("INVALID_TIME_ZONE");
  });

  it("a parent cannot change another parent's profile", async () => {
    const [a, b] = await Promise.all([registerParent("A"), registerParent("B")]);
    const { data } = await a.client
      .from("profiles")
      .update({ display_name: "Hacked" })
      .eq("id", b.userId)
      .select("id");
    expect(data).toEqual([]);
    const { data: bProfile } = await b.client
      .from("profiles")
      .select("display_name")
      .eq("id", b.userId)
      .single();
    expect(bProfile?.display_name).toBe("B");
  });
});
