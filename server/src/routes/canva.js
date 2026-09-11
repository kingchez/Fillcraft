// Canva Connect API integration.
//
// Status: the OAuth handshake below is fully implemented and will work once
// CANVA_CLIENT_ID / CANVA_CLIENT_SECRET / CANVA_REDIRECT_URI are set in the
// environment (create a Canva Developer app at canva.com/developers to get
// these). What's intentionally NOT done yet:
//   - persisting the access/refresh token anywhere (there's no user/account
//     model yet to attach it to)
//   - the design-export -> download -> create-template pipeline in
//     /designs and /import/:designId
// Both return 501 with a clear message until that's built. Manual upload via
// POST /api/templates does not depend on any of this and works today.

export default async function canvaRoutes(app) {
  app.get('/status', async () => ({
    configured: !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET && process.env.CANVA_REDIRECT_URI),
  }));

  app.get('/connect', async (req, reply) => {
    if (!process.env.CANVA_CLIENT_ID) {
      return reply.code(501).send({
        error: 'canva_not_configured',
        message:
          'Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, and CANVA_REDIRECT_URI in your environment to enable Canva import. See README.md > "Canva import".',
      });
    }
    const params = new URLSearchParams({
      client_id: process.env.CANVA_CLIENT_ID,
      redirect_uri: process.env.CANVA_REDIRECT_URI,
      response_type: 'code',
      scope: 'design:content:read design:meta:read',
    });
    reply.redirect(`https://www.canva.com/api/oauth/authorize?${params.toString()}`);
  });

  app.get('/callback', async (req, reply) => {
    const { code } = req.query || {};
    if (!code) return reply.code(400).send({ error: 'missing_code' });

    try {
      const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: process.env.CANVA_CLIENT_ID,
          client_secret: process.env.CANVA_CLIENT_SECRET,
          redirect_uri: process.env.CANVA_REDIRECT_URI,
        }),
      });
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        return reply.code(502).send({ error: 'canva_token_exchange_failed', details: tokenData });
      }

      // TODO: persist tokenData.access_token / refresh_token once an
      // account/session model exists. For now, confirm the handshake works.
      reply.send({
        ok: true,
        note: 'OAuth handshake succeeded but the token is not persisted yet — this is the next piece to build.',
        received_access_token: !!tokenData.access_token,
      });
    } catch (err) {
      reply.code(500).send({ error: 'canva_oauth_failed', message: err.message });
    }
  });

  app.get('/designs', async (req, reply) => {
    reply.code(501).send({
      error: 'not_implemented',
      message: 'Requires stored Canva access tokens (see /api/canva/callback TODO) before this can list real designs.',
    });
  });

  app.post('/import/:designId', async (req, reply) => {
    reply.code(501).send({
      error: 'not_implemented',
      message: 'Design export + template creation pipeline pending token storage above. Use manual upload (POST /api/templates) in the meantime.',
    });
  });
}
