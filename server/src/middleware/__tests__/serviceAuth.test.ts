import { serviceAuth } from '../serviceAuth';

describe('serviceAuth', () => {
  const reply = () => {
    const r: any = { statusCode: 0, sent: undefined };
    r.code = (c: number) => { r.statusCode = c; return r; };
    r.send = (b: any) => { r.sent = b; return r; };
    return r;
  };

  beforeEach(() => { process.env.LUMINA_SERVICE_API_KEY = 'secret-key'; });

  it('passes with correct bearer token', async () => {
    const req: any = { headers: { authorization: 'Bearer secret-key' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(0); // untouched
  });

  it('rejects missing header with 401', async () => {
    const req: any = { headers: {} };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(401);
  });

  it('rejects wrong token with 401', async () => {
    const req: any = { headers: { authorization: 'Bearer nope' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(401);
  });

  it('rejects when env key unset with 500', async () => {
    delete process.env.LUMINA_SERVICE_API_KEY;
    const req: any = { headers: { authorization: 'Bearer secret-key' } };
    const rep = reply();
    await serviceAuth(req, rep);
    expect(rep.statusCode).toBe(500);
  });
});
