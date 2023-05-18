import {Entity, Column, PrimaryGeneratedColumn, ManyToOne} from "typeorm"
import {Task} from "./Task";

@Entity()
export class Result {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToOne(() => Task, (task) => task.results)
  task!: Task

  @Column()
  gen!: number

  @Column()
  done!: boolean

  @Column()
  tickRange!: number

  @Column()
  rebalanceTickRange!: number

  @Column()
  earned!: string

  @Column("float")
  apr!: number

  @Column()
  rebalances!: number
}
