/** 大厅里选的开局配置：人数（4 人局 / 5 人轮换）+ 买码张数（4 人局恒为 0）。 */
export interface NanfengLobbySetup {
  /** 4 = 固定 4 人局；5 = 5 人轮换（每局换一个人下场买码）。 */
  players: 4 | 5
  /** 买码张数；4 人局恒为 0。 */
  ma: number
}
