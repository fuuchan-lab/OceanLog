import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractBoat, extractLicense, findDates, normalize } from './docExtract.ts'

test('全角を半角に、日本語の間の空白を消す', () => {
  assert.equal(normalize('船 名 　海 風 丸　長さ ５．８０ ｍ'), '船名海風丸長さ 5.80 m')
  assert.equal(extractBoat('船 名 海 風 丸 長 さ 5.8').name, '海風丸')
})

test('和暦・西暦の日付', () => {
  assert.deepEqual(
    findDates('令和9年10月1日 まで / 2026年3月31日 / 平成31年4月30日 / 令和元年5月1日').map((d) => d.iso),
    ['2027-10-01', '2026-03-31', '2019-04-30', '2019-05-01'],
  )
})

test('船舶検査証書から船の情報', () => {
  const text = `船 舶 検 査 証 書
船舶番号 282-12345 神奈川
船名 海風丸
長さ 5.80 m 幅 2.10 m 深さ 0.95 m
最大搭載人員 旅客 0人 船員 1人 その他の乗船者 4人 計 5人
推進機関 ガソリン機関 1基 出力 66.2 kW
有効期間 令和10年6月14日まで`
  const b = extractBoat(text)
  assert.equal(b.name, '海風丸')
  assert.equal(b.registration, '282-12345')
  assert.equal(b.length, 5.8)
  assert.equal(b.beam, 2.1)
  assert.equal(b.depth, 0.95)
  assert.equal(b.capacity, 5)
  assert.equal(b.horsepower, 90)
  assert.equal(b.inspectionExpiry, '2028-06-14')
})

test('馬力の表記', () => {
  assert.equal(extractBoat('船外機 115PS').horsepower, 115)
  assert.equal(extractBoat('定員 6人').capacity, 6)
})

test('免許証から種類と次の更新日', () => {
  const l = extractLicense(`小型船舶操縦免許証
二級小型船舶操縦士（湖川小型を除く）
交付 令和4年9月1日
令和9年8月31日まで有効`)
  assert.equal(l.licenseType, '二級小型船舶操縦士')
  assert.equal(l.licenseExpiry, '2027-08-31')
  assert.equal(extractLicense('二級小型船舶操縦士（湖川小型）').licenseType, '二級小型船舶操縦士（湖川小型）')
  assert.equal(extractLicense('ー級小型船舶操縦士 有効期間 2029/01/15').licenseType, '一級小型船舶操縦士')
  assert.equal(extractLicense('ー級小型船舶操縦士 有効期間 2029/01/15').licenseExpiry, '2029-01-15')
})
