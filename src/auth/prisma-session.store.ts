import session from 'express-session';
import { PrismaService } from '../prisma/prisma.service';

type StoredSession = session.Session & { userId?: string };

/** 将 express-session 的会话数据持久化到 PostgreSQL。 */
export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaService) {
    // express-session 在每次请求需要读取或保存登录态时调用下面的 Store 方法。
    super();
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    /**
     * 调用者：express-session 中间件读取请求 Cookie 后自动调用。
     * 调用顺序：Session.findUnique → 检查 expiresAt → 过期则删除并返回 null，
     * 有效则把 JSON data 交回 express-session，之后 Guard 才能读取 session.userId。
     */
    void this.prisma.session.findUnique({ where: { sid } })
      .then(async (record) => {
        if (!record) return callback(null, null);
        if (record.expiresAt <= new Date()) {
          await this.prisma.session.delete({ where: { sid } });
          return callback(null, null);
        }
        callback(null, record.data as unknown as session.SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    /**
     * 调用者：登录成功后 request.session 被修改，express-session 自动调用。
     * 调用顺序：读取 sess.userId → 序列化 Session → upsert sessions 表 → 回调通知中间件保存完成。
     * 没有 userId 时拒绝保存，避免把匿名空 Session 当成登录态。
     */
    const stored = sess as StoredSession;
    const userId = stored.userId;
    if (!userId) {
      callback?.(new Error('Session 缺少 userId'));
      return;
    }

    const data = JSON.parse(JSON.stringify(sess));
    const expiresAt = stored.cookie.expires ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    void this.prisma.session.upsert({
      where: { sid },
      update: { userId, data, expiresAt },
      create: { sid, userId, data, expiresAt },
    }).then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    /**
     * 调用者：AuthController.logout 的 request.session.destroy。
     * 删除 sessions 表中的 sid；删除成功后 Controller 才清除浏览器 Cookie。
     */
    void this.prisma.session.deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    /**
     * 调用者：express-session 在 rolling Cookie 的请求中自动调用。
     * 只更新 expiresAt，不改动 userId 和会话数据，用于延长仍在使用的登录态。
     */
    const expiresAt = (sess as StoredSession).cookie.expires;
    void this.prisma.session.updateMany({
      where: { sid },
      data: { expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    }).then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }
}
