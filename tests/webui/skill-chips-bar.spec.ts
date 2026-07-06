// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/webui/components/skill-chips-bar.js';
import {
  fillTemplate,
  shouldRenderChipBar,
  type ChipSkill,
} from '../../src/webui/components/skill-chips-bar.js';
import type { SkillChipsBar } from '../../src/webui/components/skill-chips-bar.js';
import type { AgentProfile } from '../../src/core/agent/agent-profile.js';

/**
 * §0.3.0 Task 15: <skill-chips-bar> + 模板填充测试
 *
 * 验证 7 个 brief 场景：
 * 1. chip bar only shows for default agent (shouldRenderChipBar utility)
 * 2. chip shows displayName
 * 3. click chip triggers skill-select
 * 4. empty input → overwrite with template (fillTemplate)
 * 5. has content → append template (fillTemplate)
 * 6. {{cursor}} placeholder → cursor positioned there (fillTemplate)
 * 7. no visibleSkills → bar not rendered
 *
 * + 补充：
 * - active chip 高亮
 * - 点击 active chip 取消选中（dispatch slug=null）
 * - template 空时仅激活 skill（不填入输入框）
 * - template 无 {{cursor}} → cursor 末尾
 * - professional agent 不渲染 chip bar
 * - chip 区横向滚动布局
 */

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor<T>(fn: () => T, timeout = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      return fn();
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  return fn();
}

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'Default Assistant',
    description: 'General purpose assistant',
    userId: 'user-1',
    type: 'default',
    slug: 'default',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    personality: '',
    ...overrides,
  };
}

function makeChipSkill(overrides: Partial<ChipSkill> = {}): ChipSkill {
  return {
    slug: 'skill-a',
    displayName: 'Skill A',
    template: 'do something with {{cursor}} here',
    ...overrides,
  };
}

describe('Task 15: <skill-chips-bar> + 模板填充', () => {
  let bar: SkillChipsBar;

  beforeEach(() => {
    document.body.innerHTML = '';
    bar = document.createElement('skill-chips-bar') as SkillChipsBar;
    document.body.appendChild(bar);
  });

  describe('component', () => {
    it('chip 显示 displayName', async () => {
      bar.visibleSkills = [
        makeChipSkill({ slug: 'a', displayName: '代码助手' }),
        makeChipSkill({ slug: 'b', displayName: '写作助手' }),
      ];
      bar.activeSkill = null;
      await settled(bar);

      const chips = bar.shadowRoot?.querySelectorAll('.chip');
      expect(chips?.length).toBe(2);
      expect(chips?.[0].textContent).toContain('代码助手');
      expect(chips?.[1].textContent).toContain('写作助手');
    });

    it('点击 chip 触发 skill-select 事件（含 slug + template）', async () => {
      bar.visibleSkills = [
        makeChipSkill({
          slug: 'code',
          displayName: 'Code',
          template: 'review this code {{cursor}} please',
        }),
      ];
      bar.activeSkill = null;
      await settled(bar);

      let detail: { slug: string | null; template?: string } | null = null;
      bar.addEventListener('skill-select', (e: Event) => {
        detail = (e as CustomEvent).detail as {
          slug: string | null;
          template?: string;
        };
      });

      const chip = bar.shadowRoot?.querySelector('.chip') as HTMLElement;
      expect(chip).toBeTruthy();
      chip.click();

      await waitFor(() => {
        if (!detail) throw new Error('not yet');
      });
      expect(detail).not.toBeNull();
      expect(detail!.slug).toBe('code');
      expect(detail!.template).toBe('review this code {{cursor}} please');
    });

    it('点击 active chip 取消选中（dispatch slug=null）', async () => {
      bar.visibleSkills = [makeChipSkill({ slug: 'code', displayName: 'Code' })];
      bar.activeSkill = 'code';
      await settled(bar);

      let detail: { slug: string | null; template?: string } | null = null;
      bar.addEventListener('skill-select', (e: Event) => {
        detail = (e as CustomEvent).detail as {
          slug: string | null;
          template?: string;
        };
      });

      const chip = bar.shadowRoot?.querySelector('.chip') as HTMLElement;
      chip.click();

      await waitFor(() => {
        if (detail === null) throw new Error('not yet');
      });
      expect(detail!.slug).toBeNull();
    });

    it('active chip 高亮', async () => {
      bar.visibleSkills = [
        makeChipSkill({ slug: 'a', displayName: 'A' }),
        makeChipSkill({ slug: 'b', displayName: 'B' }),
      ];
      bar.activeSkill = 'b';
      await settled(bar);

      const chips = bar.shadowRoot?.querySelectorAll('.chip');
      expect(chips?.length).toBe(2);
      expect(chips?.[0].classList.contains('active')).toBe(false);
      expect(chips?.[1].classList.contains('active')).toBe(true);
    });

    it('无 visibleSkills 时 chip 区不渲染', async () => {
      bar.visibleSkills = [];
      bar.activeSkill = null;
      await settled(bar);

      const container = bar.shadowRoot?.querySelector('.chips-container');
      expect(container).toBeNull();
    });

    it('chip 区横向滚动布局（overflow-x: auto）', async () => {
      bar.visibleSkills = [makeChipSkill({ slug: 'a', displayName: 'A' })];
      bar.activeSkill = null;
      await settled(bar);

      const container = bar.shadowRoot?.querySelector('.chips-container') as HTMLElement;
      expect(container).toBeTruthy();
      const style = getComputedStyle(container);
      // overflow-x 应为 auto 或 scroll（横向滚动支持）
      expect(['auto', 'scroll']).toContain(style.overflowX);
    });

    it('template 为空时 dispatch slug + 空 template（上层仅激活 skill）', async () => {
      bar.visibleSkills = [
        makeChipSkill({
          slug: 'plain',
          displayName: 'Plain',
          template: undefined,
        }),
      ];
      bar.activeSkill = null;
      await settled(bar);

      let detail: { slug: string | null; template?: string } | null = null;
      bar.addEventListener('skill-select', (e: Event) => {
        detail = (e as CustomEvent).detail as {
          slug: string | null;
          template?: string;
        };
      });

      const chip = bar.shadowRoot?.querySelector('.chip') as HTMLElement;
      chip.click();

      await waitFor(() => {
        if (detail === null) throw new Error('not yet');
      });
      expect(detail!.slug).toBe('plain');
      expect(detail!.template).toBeUndefined();
    });
  });

  describe('fillTemplate (pure utility)', () => {
    it('空输入框 → 覆盖填入 template', () => {
      const result = fillTemplate('', 'review this code');
      expect(result.value).toBe('review this code');
      expect(result.cursorPos).toBe('review this code'.length);
    });

    it('有内容 → 追加 template（含分隔符）', () => {
      const result = fillTemplate('existing text', 'new template');
      // 追加 + 分隔符（\n）
      expect(result.value).toBe('existing text\nnew template');
      // cursor 在末尾
      expect(result.cursorPos).toBe(result.value.length);
    });

    it('{{cursor}} 占位符 → 光标定位到该处', () => {
      const template = 'fix {{cursor}} bug';
      const result = fillTemplate('', template);
      // {{cursor}} 被移除
      expect(result.value).toBe('fix  bug');
      // cursor 在 'fix ' 之后（占位符位置）
      expect(result.cursorPos).toBe('fix '.length);
    });

    it('{{cursor}} 占位符 + 已有内容 → 光标在追加后的占位符位置', () => {
      const template = 'fix {{cursor}} bug';
      const result = fillTemplate('hello', template);
      // 'hello' + '\n' + 'fix  bug'（{{cursor}} 已移除）
      expect(result.value).toBe('hello\nfix  bug');
      // cursor 在 'hello\nfix ' 之后（占位符在追加部分的位置）
      expect(result.cursorPos).toBe('hello\nfix '.length);
    });

    it('template 不含 {{cursor}} → 光标默认在末尾', () => {
      const result = fillTemplate('', 'no cursor here');
      expect(result.cursorPos).toBe('no cursor here'.length);
    });

    it('template 为空 → 不修改输入框（cursor 末尾）', () => {
      const result = fillTemplate('existing', '');
      expect(result.value).toBe('existing');
      expect(result.cursorPos).toBe('existing'.length);
    });

    it('template 为空 + 输入为空 → 不变', () => {
      const result = fillTemplate('', '');
      expect(result.value).toBe('');
      expect(result.cursorPos).toBe(0);
    });

    it('多个 {{cursor}} 占位符 → 仅移除第一个，cursor 定位到首个', () => {
      const template = 'a {{cursor}} b {{cursor}} c';
      const result = fillTemplate('', template);
      // 仅移除第一个
      expect(result.value).toBe('a  b {{cursor}} c');
      expect(result.cursorPos).toBe('a '.length);
    });
  });

  describe('shouldRenderChipBar (default agent only)', () => {
    it('default agent → 返回 true', () => {
      const agents: AgentProfile[] = [
        makeAgent({ slug: 'default', type: 'default' }),
        makeAgent({ slug: 'agent-1', type: 'professional' }),
      ];
      expect(shouldRenderChipBar(agents, 'default')).toBe(true);
    });

    it('professional agent → 返回 false', () => {
      const agents: AgentProfile[] = [
        makeAgent({ slug: 'default', type: 'default' }),
        makeAgent({ slug: 'agent-1', type: 'professional' }),
      ];
      expect(shouldRenderChipBar(agents, 'agent-1')).toBe(false);
    });

    it('currentAgentSlug 不存在 → 返回 false', () => {
      const agents: AgentProfile[] = [
        makeAgent({ slug: 'default', type: 'default' }),
      ];
      expect(shouldRenderChipBar(agents, 'non-existent')).toBe(false);
    });

    it('空 agents 列表 → 返回 false', () => {
      expect(shouldRenderChipBar([], 'default')).toBe(false);
    });
  });
});
