// Labels and descriptions are for a local rules prototype. No publisher art is included.
export const ROLES = [
  { id: 'alchemist', name: '炼金术士', english: 'Alchemist', icon: '⚗', tag: '调整点数', text: '主移动骰为 1 或 2 时，可改为移动 4 格。' },
  { id: 'blimp', name: '飞艇', english: 'Blimp', icon: '◒', tag: '前段加速', text: '回合开始时在第二弯道前，主移动 +3；否则 −1。' },
  { id: 'coach', name: '教练', english: 'Coach', icon: '⚑', tag: '同格加速', text: '与自己同格的所有选手，主移动 +1。' },
  { id: 'hare', name: '兔子', english: 'Hare', icon: '♞', tag: '快与慢', text: '主移动 +2；回合开始时独自领先，则跳过主移动。' },
  { id: 'legs', name: '大长腿', english: 'Legs', icon: '↟', tag: '稳定前进', text: '可以不掷骰，直接以 5 格作为主移动基础值。' },
  { id: 'magician', name: '魔术师', english: 'Magician', icon: '✦', tag: '两次重掷', text: '主移动骰可重掷最多两次，使用最后一次结果。' },
  { id: 'rocket', name: '火箭科学家', english: 'Rocket Scientist', icon: '↗', tag: '冲刺摔倒', text: '掷骰后可选择翻倍移动，完成后摔倒。' },
  { id: 'gunk', name: '黏黏怪', english: 'Gunk', icon: '●', tag: '全场减速', text: '其他选手的主移动距离 −1，不改变骰面。' },
  { id: 'lackey', name: '跟班', english: 'Lackey', icon: '♧', tag: '借势前进', text: '别人主移动掷出 6 时，先于对方移动 2 格。' },
  { id: 'inchworm', name: '尺蠖', english: 'Inchworm', icon: '∿', tag: '接管低点', text: '别人主移动掷出 1 时，对方跳过该移动，自己前进 1 格。' },
  { id: 'banana', name: '香蕉', english: 'Banana', icon: '☽', tag: '超车陷阱', text: '其他选手从自己后方移动到前方时，使对方摔倒。' },
  { id: 'heckler', name: '毒舌喷子', english: 'Heckler', icon: '≋', tag: '低速受益', text: '选手回合结束时距本回合起点不超过 1 格，自己前进 2 格。' },
];
export const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));
export const RULESET = {
  id: 'local-lab-12-v1', rounds: 4, finish: 30, secondCorner: 15,
  prizes: [[3, 1], [4, 2], [5, 3], [6, 4]],
  // Experimental board. These are deliberately NOT represented as the physical game's map.
  special: { 4: { type: 'star' }, 7: { type: 'arrow', amount: 2 }, 12: { type: 'trip' }, 17: { type: 'star' }, 21: { type: 'arrow', amount: -2 }, 26: { type: 'star' } },
};
