import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { PaginationDto } from 'src/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { SERVICES } from 'src/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(`OrdersService`);

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`Database Conected`);
  }

  constructor(
    @Inject(SERVICES.PRODUCT_SERVICE) private readonly productsClient: ClientProxy,
  ) {
    super();
  }

  async create(createOrderDto: CreateOrderDto) {
   

    try {
      
      const  productsIds = createOrderDto.items.map( item => item.productId);

     
      const products: any[] = await firstValueFrom(
        this.productsClient.send({ cmd: 'validate_product' }, productsIds),
      );
  
      //2. Calculos de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) =>{

        const price = products.find( product => product.id === orderItem.productId).price; 

        return price * orderItem.quantity;

      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem)=> {
        return acc + orderItem.quantity;
      }, 0)


       //3. Crear una transacion de base de datos
      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find( product => product.id === orderItem.productId).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      })

      return {
        ...order,
        OrderItem: order.OrderItem.map( orderItem => ({
          ...orderItem,
          name: products.find( product => product.id === orderItem.productId).name
        }))
      }


    } catch (error) {
      throw new RpcException({
        message: 'Check logs',
        status: HttpStatus.BAD_REQUEST,
      }) 
    }

  

  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;

    const total = await this.order.count({
      where: {
        status: status,
      },
    });

    const lastPage = Math.ceil(total / limit);

    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: {
          status: status,
        },
      }),
      meta: {
        total: total,
        page: page,
        lastPage,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findUnique({
      where: {
        id,
      },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      }
    });

    if (!order) {
      throw new RpcException({
        message: `Order with id: ${id} not found`,
        status: HttpStatus.NOT_FOUND,
      });
    }



    const productsIds = order.OrderItem.map( orderItem => orderItem.productId);

    const products = await firstValueFrom(
      this.productsClient.send({ cmd: 'validate_product' }, productsIds),
    );

    


    return {
      ...order,
      OrderItem: order.OrderItem.map( orderItem =>({
        ...orderItem,
        name: products.find( product => product.id === orderItem.productId).name,
      }) )
    }
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);

    if (order.status === status) {
      return order;
    }

    return this.order.update({
      where: {
        id,
      },
      data: {
        status: status,
      },
    });
  }
}
