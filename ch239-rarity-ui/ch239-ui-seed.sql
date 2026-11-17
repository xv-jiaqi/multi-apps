-- CH-239 UI 截图用模拟数据（仅本机库 cardhub_ch239ui）：30th 两张平行卡 + 一个没有官方码的旧品类系列
INSERT INTO cards (id, slug, name, rarity, attributes, "seriesId", "createdAt", "updatedAt", "cardNumber", "subsetId", "cardNumberNormalized", "parallelOfId", "parallelName", "printRun")
SELECT 'sim-par-001', 'ptcg-sc-30th-001-mirror', c.name, 'epic', jsonb_set(c.attributes, '{稀有度}', '"MA"'), c."seriesId", now(), now(), c."cardNumber", c."subsetId", c."cardNumberNormalized", c.id, '镜面闪', NULL
FROM cards c WHERE c.slug = 'ptcg-sc-30th-001';
INSERT INTO cards (id, slug, name, rarity, attributes, "seriesId", "createdAt", "updatedAt", "cardNumber", "subsetId", "cardNumberNormalized", "parallelOfId", "parallelName", "printRun")
SELECT 'sim-par-124', 'ptcg-sc-30th-124-gold', c.name, 'legendary', c.attributes, c."seriesId", now(), now(), c."cardNumber", c."subsetId", c."cardNumberNormalized", c.id, '金框', 99
FROM cards c WHERE c.slug = 'ptcg-sc-30th-124';
INSERT INTO series (id, slug, title, "createdAt", "updatedAt") VALUES ('sim-legacy', 'sim-legacy-set', '旧品类示例（模拟）', now(), now());
INSERT INTO cards (id, slug, name, rarity, attributes, "seriesId", "createdAt", "updatedAt", "cardNumber")
VALUES ('sim-l1','sim-legacy-1','晨星骑士','rare','{"cost":3,"attack":2}','sim-legacy',now(),now(),'1'),
       ('sim-l2','sim-legacy-2','暮色法师','epic','{"cost":4}','sim-legacy',now(),now(),'2'),
       ('sim-l3','sim-legacy-3','见习剑士','common','{}','sim-legacy',now(),now(),'3');
-- 追加：空系列
INSERT INTO series (id, slug, title, "createdAt", "updatedAt") VALUES ('sim-empty','sim-empty-set','空系列示例（模拟）',now(),now());
-- 追加：10 字长码系列（Spec CH-239 v1.3 §10-10）
INSERT INTO series (id, slug, title, "createdAt", "updatedAt") VALUES ('sim-long','sim-long-code-set','长码示例（模拟）',now(),now());
INSERT INTO cards (id, slug, name, rarity, attributes, "seriesId", "createdAt", "updatedAt", "cardNumber")
VALUES ('sim-long-1','sim-long-1','晨星骑士','common','{"稀有度":"C"}','sim-long',now(),now(),'1'),
       ('sim-long-2','sim-long-2','暮色法师','legendary','{"稀有度":"超级稀有特别插画平行"}','sim-long',now(),now(),'2');
