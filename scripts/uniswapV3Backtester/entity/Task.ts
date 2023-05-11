import {Entity, Column, PrimaryGeneratedColumn, OneToMany} from "typeorm"
import {Result} from "./Result";
import {IConfig} from "../types";

@Entity()
export class Task {
  @PrimaryGeneratedColumn()
  id!: number

  @Column('boolean', {default: false})
  done!: boolean

  @Column()
  pool!: string

  @Column()
  vaultAsset!: string

  @Column()
  startBlock!: number

  @Column()
  endBlock!: number

  @Column()
  investAmountUnits!: string

  @Column("jsonb")
  config!: IConfig

  @OneToMany(() => Result, (result) => result.task)
  results!: Result[]
}